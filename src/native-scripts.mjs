// These functions are serialized into the official CLI. Keep them self-contained.
async function readProject(p) {
  const first = await eda.dmt_Project.getCurrentProjectInfo();
  if (!first?.uuid) return { status: 'unknown', code: 'NO_CURRENT_PROJECT' };
  if (p.expectedProjectUuid && first.uuid !== p.expectedProjectUuid)
    return { status: 'failed', code: 'TARGET_MISMATCH', expected: p.expectedProjectUuid, actual: first.uuid };
  const documents = [], boards = [], visited = new Set();
  function walk(item, boardName) {
    if (!item || typeof item !== 'object') return;
    if (documents.length > 2000) throw new Error('PROJECT_TOO_LARGE');
    if (item.itemType === 'Board') {
      boards.push({ name: item.name, schematicUuid: item.schematic?.uuid ?? null,
        pcbDocumentUuid: item.pcb?.uuid ?? null, schematicPageUuids: (item.schematic?.page ?? []).map(x => x.uuid) });
      walk(item.schematic, item.name); walk(item.pcb, item.name);
      return;
    }
    if (item.uuid && !visited.has(item.uuid)) {
      visited.add(item.uuid);
      documents.push({ uuid: item.uuid, name: item.name ?? null, itemType: item.itemType ?? null,
        boardName: item.parentBoardName ?? boardName ?? null,
        parentSchematicUuid: item.parentSchematicUuid ?? null });
    }
    if (Array.isArray(item.page)) item.page.forEach(x => walk(x, boardName));
  }
  if (!Array.isArray(first.data)) return { status: 'unknown', code: 'PROJECT_SCHEMA_UNSUPPORTED' };
  first.data.forEach(item => walk(item));
  const last = await eda.dmt_Project.getCurrentProjectInfo();
  if (last?.uuid !== first.uuid) return { status: 'unknown', code: 'TARGET_CHANGED_DURING_READ' };
  return { status: documents.length ? 'ok' : 'unknown',
    ...(!documents.length ? { code: 'PROJECT_TREE_NOT_READY_OR_EMPTY' } : {}),
    project: { uuid: first.uuid, name: first.name ?? null,
    friendlyName: first.friendlyName ?? null }, boards, documents };
}

async function focusDocument(p) {
  const project = await eda.dmt_Project.getCurrentProjectInfo();
  if (project?.uuid !== p.expectedProjectUuid)
    return { status: 'failed', code: 'TARGET_MISMATCH', actual: project?.uuid ?? null };
  const expectedType = p.kind === 'pcb' ? 'PCB' : 'Schematic Page';
  let found;
  function walk(item) {
    if (!item || typeof item !== 'object') return;
    if (item.uuid === p.documentUuid) found = item;
    if (item.schematic) walk(item.schematic);
    if (item.pcb) walk(item.pcb);
    if (Array.isArray(item.page)) item.page.forEach(walk);
  }
  (project.data ?? []).forEach(walk);
  if (!found || found.itemType !== expectedType)
    return { status: 'failed', code: 'DOCUMENT_NOT_IN_TARGET', documentUuid: p.documentUuid, kind: p.kind };
  const current = await eda.dmt_SelectControl.getCurrentDocumentInfo();
  if (current?.uuid === p.documentUuid && current.parentProjectUuid === p.expectedProjectUuid)
    return { status: 'ok', focusAction: 'already_active', tabId: current.tabId };
  const tree = await eda.dmt_EditorControl.getSplitScreenTree();
  const expectedTab = p.documentUuid + '@' + p.expectedProjectUuid;
  let existing;
  function tabs(node) {
    for (const t of node?.tabs ?? []) if (t.tabId === expectedTab) existing = t;
    for (const child of node?.children ?? []) tabs(child);
  }
  tabs(tree);
  if (existing) {
    const ok = await eda.dmt_EditorControl.activateDocument(existing.tabId);
    return { status: ok ? 'ok' : 'unknown', focusAction: 'activate_existing', tabId: existing.tabId };
  }
  const tabId = await eda.dmt_EditorControl.openDocument(p.documentUuid);
  return { status: tabId ? 'ok' : 'unknown', focusAction: 'open_document', tabId: tabId ?? null };
}

async function readDocument(p) {
  async function matches() {
    const project = await eda.dmt_Project.getCurrentProjectInfo();
    const doc = await eda.dmt_SelectControl.getCurrentDocumentInfo();
    return project?.uuid === p.expectedProjectUuid && doc?.parentProjectUuid === p.expectedProjectUuid
      && doc?.uuid === p.documentUuid && doc.documentType === (p.kind === 'pcb' ? 3 : 1);
  }
  if (!await matches()) return { status: 'unknown', code: 'DOCUMENT_NOT_READY_OR_CHANGED' };
  const isPcb = p.kind === 'pcb';
  const api = isPcb ? eda.pcb_PrimitiveComponent : eda.sch_PrimitiveComponent;
  const all = await api.getAll();
  if (!Array.isArray(all)) return { status: 'unknown', code: 'COMPONENT_READ_UNAVAILABLE' };
  const physical = isPcb ? all : all.filter(c => c.getState_ComponentType() === 'part');
  const parts = [];
  for (const c of physical.slice(0, p.limit)) {
    const state = name => typeof c[name] === 'function' ? c[name]() ?? null : null;
    const item = {
      id: state('getState_PrimitiveId'), designator: state('getState_Designator'),
      name: state('getState_Name'), supplierId: state('getState_SupplierId'),
      manufacturerPart: state('getState_ManufacturerId'), uniqueId: state('getState_UniqueId'),
      x: state('getState_X'), y: state('getState_Y'), rotation: state('getState_Rotation'),
      layer: isPcb ? state('getState_Layer') : null, footprint: state('getState_Footprint')
    };
    item.properties = state('getState_OtherProperty');
    item.device = state('getState_Component');
    item.symbol = isPcb ? null : state('getState_Symbol');
    item.subPartName = isPcb ? null : state('getState_SubPartName');
    item.mirror = isPcb ? null : state('getState_Mirror');
    item.addIntoPcb = isPcb ? null : state('getState_AddIntoPcb');
    item.model3D = isPcb ? state('getState_Model3D') : null;
    if(isPcb)item.primitiveLock=state('getState_PrimitiveLock');
    if (p.includeGeometry) item.primitiveBounds = (isPcb
      ? await eda.pcb_Primitive.getPrimitivesBBox([item.id])
      : await eda.sch_Primitive.getPrimitivesBBox([item.id])) ?? null;
    if (p.includePins) {
      const pins = await api.getAllPinsByPrimitiveId(item.id);
      if (!Array.isArray(pins)) return { status: 'unknown', code: 'PIN_READ_UNAVAILABLE', componentId: item.id };
      item.pins = pins.map(pin => {
        const q = key => typeof pin[key] === 'function' ? pin[key]() ?? null : null;
        return { id: q('getState_PrimitiveId'),
          number: q(isPcb ? 'getState_PadNumber' : 'getState_PinNumber'),
          x: q('getState_X'), y: q('getState_Y'), rotation: q('getState_Rotation'),
          net: isPcb ? q('getState_Net') : null,
          noConnected: isPcb ? null : q('getState_NoConnected') };
      });
      if (p.includeGeometry) for (let i=0; i<pins.length; i++) {
        const pin = pins[i], q = key => typeof pin[key] === 'function' ? pin[key]() ?? null : null;
        Object.assign(item.pins[i], { name: isPcb ? null : q('getState_PinName'),
          pinType: isPcb ? null : q('getState_pinType'), layer: isPcb ? q('getState_Layer') : null,
          padShape: isPcb ? q('getState_Pad') : null, hole: isPcb ? q('getState_Hole') : null, metallization:isPcb?q('getState_Metallization'):null });
      }
    }
    parts.push(item);
  }
  const counts = { components: physical.length };
  if (isPcb) {
    counts.lines = (await eda.pcb_PrimitiveLine.getAll()).length;
    counts.viaObjects = (await eda.pcb_PrimitiveVia.getAll()).length;
    counts.polylines = (await eda.pcb_PrimitivePolyline.getAll()).length;
  } else {
    counts.wires = (await eda.sch_PrimitiveWire.getAll()).length;
    counts.nonPartComponents = all.length - physical.length;
  }
  if (!await matches()) return { status: 'unknown', code: 'TARGET_CHANGED_DURING_READ' };
  return { status: 'ok', projectUuid: p.expectedProjectUuid, documentUuid: p.documentUuid,
    kind: p.kind, coordinates: isPcb ? 'mil; native data coordinates' : 'native schematic coordinates',
    counts, components: parts, returnedComponents: parts.length, truncated: parts.length < physical.length,
    coverage: { schematicLogicalNetlist: false, drcRun: false, saveVerified: false,
      componentCountUnit: isPcb ? 'footprint instances' : 'symbol instances; multi-unit devices may occur more than once',
      geometryBoundsMeaning: p.includeGeometry ? 'native primitive bounds; mechanical and 3D body bounds not verified' : null,
      note: 'Counts and geometry are a read-only snapshot, not connectivity or manufacturing acceptance.' } };
}

export const scripts = {
  project: p => '(' + readProject.toString() + ')(' + JSON.stringify(p) + ')',
  focus: p => '(' + focusDocument.toString() + ')(' + JSON.stringify(p) + ')',
  document: p => '(' + readDocument.toString() + ')(' + JSON.stringify(p) + ')',
  focusedDocument: p => `(async()=>{const focusDocument=${focusDocument.toString()};const readDocument=${readDocument.toString()};const p=${JSON.stringify(p)};const focused=await focusDocument(p);if(focused.status!=='ok')return focused;for(let attempt=0;attempt<4;attempt++){const result=await readDocument(p);if(result.code!=='DOCUMENT_NOT_READY_OR_CHANGED')return {...result,focusAction:focused.focusAction};if(attempt<3)await new Promise(r=>setTimeout(r,250));}return {status:'unknown',code:'DOCUMENT_NOT_READY_OR_CHANGED'};})()`
};
