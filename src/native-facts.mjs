// Runs only these fixed, read-only operations in the official editor command space.
async function readFacts(p) {
  const project = await eda.dmt_Project.getCurrentProjectInfo();
  if (project?.uuid !== p.expectedProjectUuid)
    return { status: 'failed', code: 'TARGET_MISMATCH', actual: project?.uuid ?? null };
  const sameProject = async () => (await eda.dmt_Project.getCurrentProjectInfo())?.uuid === p.expectedProjectUuid;
  const changed = () => ({ status: 'unknown', code: 'TARGET_CHANGED_DURING_READ' });
  const state = (x, key) => typeof x[key] === 'function' ? x[key]() ?? null : null;
  if (p.operation === 'search') {
    const libraryUuid = p.libraryUuid || await eda.lib_LibrariesList.getSystemLibraryUuid();
    if (!libraryUuid) return { status: 'unknown', code: 'LIBRARY_ID_UNAVAILABLE' };
    const hits = p.properties
      ? await eda.lib_Device.searchByProperties(p.properties, libraryUuid, undefined, undefined, p.limit, p.page)
      : await eda.lib_Device.search(p.query, libraryUuid, undefined, undefined, p.limit, p.page);
    if (!await sameProject()) return changed();
    if (!Array.isArray(hits)) return { status: 'unknown', code: 'DEVICE_SEARCH_UNAVAILABLE' };
    return { status: 'ok', libraryUuid, hits: hits.slice(0, p.limit), page: p.page,
      moreResultsPossible: hits.length >= p.limit, source: 'eda.lib_Device; native library data' };
  }
  if (p.operation === 'device') {
    const device = await eda.lib_Device.get(p.deviceUuid, p.libraryUuid);
    if (!await sameProject()) return changed();
    if (!device) return { status: 'failed', code: 'DEVICE_NOT_FOUND' };
    if (device.uuid !== p.deviceUuid || (device.libraryUuid && device.libraryUuid !== p.libraryUuid))
      return { status: 'unknown', code: 'LIBRARY_TARGET_MISMATCH' };
    return { status: 'ok', device, source: 'eda.lib_Device.get; native library metadata' };
  }
  if (p.operation === 'model_source') {
    const api = p.kind === 'footprint' ? eda.lib_Footprint : eda.lib_Symbol;
    if (typeof api?.getDocumentSource !== 'function')
      return { status: 'unsupported', code: 'MODEL_SOURCE_API_UNAVAILABLE' };
    const metadata = await api.get(p.modelUuid, p.libraryUuid);
    if (metadata?.uuid !== p.modelUuid || metadata?.libraryUuid !== p.libraryUuid)
      return { status: 'unknown', code: 'LIBRARY_TARGET_MISMATCH' };
    const projectLibraryUuid = await eda.lib_LibrariesList.getProjectLibraryUuid();
    const source = await api.getDocumentSource(p.modelUuid, p.libraryUuid);
    if (!await sameProject()) return changed();
    if (typeof source !== 'string' || !source.length || source.length > 2 * 1024 * 1024)
      return { status: 'unknown', code: 'MODEL_SOURCE_UNAVAILABLE_OR_TOO_LARGE' };
    if (!projectLibraryUuid) return { status: 'unknown', code: 'MODEL_LIBRARY_SCOPE_UNPROVEN' };
    return { status: 'ok', kind: p.kind, modelUuid: p.modelUuid, libraryUuid: p.libraryUuid,
      metadata, source, projectUuid: p.expectedProjectUuid,
      sourceApi: p.kind === 'footprint' ? 'eda.lib_Footprint.getDocumentSource' : 'eda.lib_Symbol.getDocumentSource',
      sourceScope: p.libraryUuid === projectLibraryUuid ? 'current_project_library' : 'requested_external_library',
      persistenceVerified: false, focusAction: 'none; direct library source' };
  }
  if (p.operation === 'model_focus' || p.operation === 'model_read') {
    const isPcb = p.kind === 'footprint', type = isPcb ? 4 : 2;
    const matches = async () => {
      const doc = await eda.dmt_SelectControl.getCurrentDocumentInfo();
      return await sameProject() && doc?.uuid === p.modelUuid
        && doc.parentLibraryUuid === p.libraryUuid && doc.documentType === type;
    };
    if (p.operation === 'model_focus') {
      if (await matches()) return { status: 'ok', focusAction: 'already_active' };
      const tree = await eda.dmt_EditorControl.getSplitScreenTree();
      const expectedTab = p.modelUuid + '@' + p.libraryUuid;
      let existing;
      function walk(node) {
        for (const tab of node?.tabs ?? []) if (tab.tabId === expectedTab) existing = tab;
        for (const child of node?.children ?? []) walk(child);
      }
      walk(tree);
      if (existing) {
        const ok = await eda.dmt_EditorControl.activateDocument(existing.tabId);
        return { status: ok ? 'ok' : 'unknown', focusAction: 'activate_existing', tabId: existing.tabId };
      }
      const tabId = await eda.dmt_EditorControl.openLibraryDocument(p.libraryUuid, isPcb ? '4' : '2', p.modelUuid);
      return { status: tabId ? 'ok' : 'needs_ui', code: tabId ? undefined : 'LIBRARY_OPEN_REQUIRES_UI',
        focusAction: 'open_library_document', tabId: tabId || null,
        target: { libraryUuid: p.libraryUuid, modelUuid: p.modelUuid, kind: p.kind },
        nextAction: tabId ? undefined : 'Open this exact library model in the editor, then read it again. No model was edited.' };
    }
    if (!await matches()) return { status: 'unknown', code: 'MODEL_NOT_READY_OR_CHANGED' };
    const api = isPcb ? eda.pcb_PrimitivePad : eda.sch_PrimitivePin;
    const all = await api.getAll();
    if (!Array.isArray(all)) return { status: 'unknown', code: 'MODEL_PRIMITIVES_UNAVAILABLE' };
    if (all.length > 1000) return { status: 'unsupported', code: 'MODEL_PIN_LIMIT' };
    const pins = all.map(pin => ({
      id: state(pin, 'getState_PrimitiveId'), number: state(pin, isPcb ? 'getState_PadNumber' : 'getState_PinNumber'),
      name: isPcb ? null : state(pin, 'getState_PinName'),
      x: state(pin, 'getState_X'), y: state(pin, 'getState_Y'), rotation: state(pin, 'getState_Rotation'),
      layer: isPcb ? state(pin, 'getState_Layer') : null,
      padShape: isPcb ? state(pin, 'getState_Pad') : null, hole: isPcb ? state(pin, 'getState_Hole') : null,
      pinType: isPcb ? null : state(pin, 'getState_pinType'),
      noConnected: isPcb ? null : state(pin, 'getState_NoConnected')
    }));
    const primitive = isPcb ? eda.pcb_Primitive : eda.sch_Primitive;
    const terminalBounds = all.length ? await primitive.getPrimitivesBBox(pins.map(x => x.id)) : null;
    const metadata = isPcb ? await eda.lib_Footprint.get(p.modelUuid, p.libraryUuid)
      : await eda.lib_Symbol.get(p.modelUuid, p.libraryUuid);
    const canvasOrigin = isPcb ? await eda.pcb_Document.getCanvasOrigin() : null;
    const source = await eda.sys_FileManager.getDocumentSource();
    if (typeof source !== 'string' || source.length > 2 * 1024 * 1024)
      return { status: 'unknown', code: 'MODEL_SOURCE_UNAVAILABLE_OR_TOO_LARGE' };
    if (!await matches()) return changed();
    return { status: 'ok', kind: p.kind, modelUuid: p.modelUuid, libraryUuid: p.libraryUuid,
      metadata, pins, terminalBounds: terminalBounds ?? null, canvasOrigin, source,
      coordinates: isPcb ? 'mil; native library coordinates' : 'native symbol coordinates',
      coverage: { mechanicalBodyBoundsVerified: false, model3dDimensionsVerified: false,
        note: 'Terminal bounds are not mechanical body size. Native coordinates are not inferred from a footprint name.' } };
  }
  if (p.operation === 'netlist') {
    const matches = async () => {
      const doc = await eda.dmt_SelectControl.getCurrentDocumentInfo();
      return await sameProject() && doc?.uuid === p.documentUuid && doc.parentProjectUuid === p.expectedProjectUuid
        && doc.documentType === 1;
    };
    if (!await matches()) return { status: 'unknown', code: 'DOCUMENT_NOT_READY_OR_CHANGED' };
    const file = await eda.sch_ManufactureData.getNetlistFile('codex-read', 'JLCEDA');
    if (!file || file.size > 2 * 1024 * 1024) return { status: 'unsupported', code: 'NETLIST_UNAVAILABLE_OR_TOO_LARGE' };
    const source = await file.text();
    if (!await matches()) return changed();
    return { status: 'ok', source, sourceApi: 'eda.sch_ManufactureData.getNetlistFile', fileName: file.name,
      projectUuid: p.expectedProjectUuid, documentUuid: p.documentUuid };
  }
  return { status: 'failed', code: 'UNKNOWN_FACT_OPERATION' };
}

export const factsScript = p => '(' + readFacts.toString() + ')(' + JSON.stringify(p) + ')';
