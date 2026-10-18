import { createHash } from 'node:crypto';
import { parseNativeSource } from './native-records.mjs';

export const digest = text => createHash('sha256').update(text).digest('hex');
const error = (code, message) => Object.assign(new Error(message), { code, status: 'unknown' });
const obj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value : null;

export function normalizeDevice(native, libraryUuid) {
  if (!obj(native) || typeof native.uuid !== 'string') throw error('DEVICE_SCHEMA_UNSUPPORTED', 'Device identity is missing.');
  const props = native.property ?? {}, other = props.otherProperty ?? native.otherProperty ?? {};
  const reference = kind => {
    const association = native.association ?? native;
    const r = association[kind];
    const uuid = r?.uuid || association[kind + 'Uuid'] || other[kind === 'symbol' ? 'Symbol' : 'Footprint'];
    return typeof uuid === 'string' && uuid ? { uuid, libraryUuid: r?.libraryUuid || native.libraryUuid || libraryUuid,
      name: r?.name || association[kind + 'Name'] || null,
      libraryResolution: r?.libraryUuid ? 'explicit' : 'same requested library; legacy reference' } : null;
  };
  const supplierId = props.supplierId ?? native.supplierId ?? other['Supplier Part'] ?? null;
  const manufacturerPart = props.manufacturerId ?? native.manufacturerId ?? other['Manufacturer Part'] ?? null;
  const datasheet = other.Datasheet;
  return {
    uuid: native.uuid, libraryUuid: native.libraryUuid || libraryUuid, name: native.name ?? null,
    manufacturer: props.manufacturer ?? native.manufacturer ?? other.Manufacturer ?? null,
    manufacturerPart, supplierId, description: native.description ?? null,
    symbol: reference('symbol'), footprint: reference('footprint'), subPartNames: native.subPartNames ?? null,
    parameters: other, datasheetUrl: typeof datasheet === 'string' && /^https?:\/\//i.test(datasheet) ? datasheet : null,
    provenance: { source: 'native EDA library metadata', fetchedAt: new Date().toISOString(),
      datasheetContentVerified: false, liveStockVerified: false, livePriceVerified: false, electricalSuitabilityAssessed: false }
  };
}

export function parseNetlist(source, expectedProjectUuid) {
  let data;
  try { data = JSON.parse(source); } catch { throw error('NETLIST_SCHEMA_UNSUPPORTED', 'Native netlist is not JSON.'); }
  if (!obj(data) || data.version !== '2.0.0' || !obj(data.components))
    throw error('NETLIST_SCHEMA_UNSUPPORTED', 'Only the observed native JLCEDA 2.0.0 netlist schema is supported.');
  if (data.projectId !== expectedProjectUuid) throw error('NETLIST_TARGET_MISMATCH', 'Netlist project does not match the selected project.');
  const entries = Object.entries(data.components);
  if (entries.length > 500) throw error('NETLIST_COMPONENT_LIMIT', 'This snapshot exceeds the 500-component read bound.');
  const components = [], issues = [], nets = new Set();
  let pinCount = 0;
  for (const [key, c] of entries) {
    if (!obj(c) || !obj(c.props) || !obj(c.pinInfoMap)) throw error('NETLIST_COMPONENT_SCHEMA', 'Malformed component or pin map.');
    const uniqueId = text(c.props['Unique ID']);
    if (!uniqueId || uniqueId !== key) issues.push({ code: 'COMPONENT_ID_AMBIGUOUS', key, uniqueId });
    const pins = [];
    for (const [pinKey, pin] of Object.entries(c.pinInfoMap)) {
      if (!obj(pin) || typeof pin.number !== 'string' || typeof pin.net !== 'string')
        throw error('NETLIST_PIN_SCHEMA', 'Pin number and net must be explicit strings.');
      if (pinKey !== pin.number || (pin.props?.['Pin Number'] !== undefined && pin.props['Pin Number'] !== pin.number))
        issues.push({ code: 'PIN_NUMBER_MAPPING_UNVERIFIED', uniqueId, pinKey, number: pin.number, propertyNumber: pin.props?.['Pin Number'] });
      pins.push({ number: pin.number, name: text(pin.name), net: pin.net });
      if (pin.net) nets.add(pin.net);
      if (++pinCount > 10000) throw error('NETLIST_PIN_LIMIT', 'This snapshot exceeds the 10000-pin read bound.');
    }
    const convert = c.props['Convert to PCB'];
    if (!['yes','no',true,false].includes(convert)) issues.push({ code: 'PCB_CONVERSION_UNSPECIFIED', uniqueId });
    components.push({ uniqueId: uniqueId || key, designator: text(c.props.Designator), name: text(c.props.Name),
      convertToPcb: convert === 'yes' || convert === true, manufacturerPart: text(c.props['Manufacturer Part']),
      supplierId: text(c.props['Supplier Part']), symbolUuid: text(c.props.Symbol), footprintUuid: text(c.props.Footprint), pins });
  }
  return { format: data.version, projectUuid: data.projectId, sourceSha256: digest(source),
    counts: { components: components.length, pins: pinCount, namedNets: nets.size },
    netNames: [...nets].sort(), components, issues };
}

export function compareAssignments(netlist, schematicDocuments, pcb) {
  const issues = [...netlist.issues], mismatches = [], matched = [];
  const groups = new Map(), pcbById = new Map();
  for (const doc of schematicDocuments) {
    if (doc.truncated) issues.push({ code: 'SCHEMATIC_SNAPSHOT_TRUNCATED', documentUuid: doc.documentUuid });
    for (const c of doc.components) {
      if (!c.uniqueId || !Array.isArray(c.pins)) { issues.push({ code: 'SCHEMATIC_ID_OR_PINS_MISSING', id: c.id }); continue; }
      if (!groups.has(c.uniqueId)) groups.set(c.uniqueId, []);
      groups.get(c.uniqueId).push(c);
    }
  }
  if (pcb?.truncated) issues.push({ code: 'PCB_SNAPSHOT_TRUNCATED' });
  for (const c of pcb?.components ?? []) {
    if (!c.uniqueId || !Array.isArray(c.pins)) { issues.push({ code: 'PCB_ID_OR_PADS_MISSING', id: c.id }); continue; }
    if (!pcbById.has(c.uniqueId)) pcbById.set(c.uniqueId, []);
    pcbById.get(c.uniqueId).push(c);
  }
  for (const c of netlist.components) {
    const symbols = groups.get(c.uniqueId) ?? [];
    if (!symbols.length) issues.push({ code: 'NETLIST_COMPONENT_WITHOUT_SYMBOL', uniqueId: c.uniqueId });
    const symbolPins = new Map();
    for (const symbol of symbols) for (const pin of symbol.pins) {
      if (!symbolPins.has(pin.number)) symbolPins.set(pin.number, []);
      symbolPins.get(pin.number).push({ ...pin, primitiveId: symbol.id, subPartName: symbol.subPartName ?? null });
    }
    const physical = pcbById.get(c.uniqueId) ?? [];
    if (pcb && !c.convertToPcb && physical.length)
      mismatches.push({ code: 'PCB_COMPONENT_MARKED_EXCLUDED', uniqueId: c.uniqueId });
    if (pcb && c.convertToPcb && physical.length !== 1)
      mismatches.push({ code: physical.length ? 'PCB_COMPONENT_ID_AMBIGUOUS' : 'PCB_COMPONENT_MISSING', uniqueId: c.uniqueId });
    const pads = physical.length === 1 ? physical[0].pins : [];
    const netNumbers = new Set(c.pins.map(p => p.number));
    for (const pin of c.pins) {
      const symbolsForPin = symbolPins.get(pin.number) ?? [], padsForPin = pads.filter(p => p.number === pin.number);
      if (!symbolsForPin.length) mismatches.push({ code: 'SYMBOL_PIN_MISSING', uniqueId: c.uniqueId, number: pin.number });
      if (symbolsForPin.some(p => p.noConnected === true) && pin.net)
        mismatches.push({ code: 'NO_CONNECT_HAS_NET', uniqueId: c.uniqueId, number: pin.number, net: pin.net });
      if (!pcb || !c.convertToPcb || physical.length !== 1) continue;
      if (!padsForPin.length) mismatches.push({ code: 'PCB_PAD_MISSING', uniqueId: c.uniqueId, number: pin.number });
      else if (padsForPin.some(p => (p.net ?? '') !== pin.net)) mismatches.push({ code: 'PIN_PAD_NET_MISMATCH',
        uniqueId: c.uniqueId, designator: c.designator, number: pin.number, schematicNet: pin.net, pcbNets: padsForPin.map(p => p.net ?? '') });
      else if (symbolsForPin.length && !symbolsForPin.some(p => p.noConnected === true && pin.net)) matched.push({ uniqueId: c.uniqueId, designator: c.designator,
        number: pin.number, net: pin.net, symbolPrimitiveIds: symbolsForPin.map(p => p.primitiveId), padIds: padsForPin.map(p => p.id) });
    }
    for (const [number] of symbolPins) if (!netNumbers.has(number))
      mismatches.push({ code: 'SYMBOL_PIN_NOT_IN_NETLIST', uniqueId: c.uniqueId, number });
    if (pcb && c.convertToPcb) for (const pad of pads) if (pad.number && !netNumbers.has(pad.number))
      mismatches.push({ code: 'PCB_PAD_NOT_IN_NETLIST', uniqueId: c.uniqueId, number: pad.number });
    for (const pad of pads) if (!pad.number && pad.net)
      mismatches.push({ code: 'UNNUMBERED_CONNECTED_PAD', uniqueId: c.uniqueId, padId: pad.id, net: pad.net });
  }
  const ids = new Set(netlist.components.map(c => c.uniqueId));
  for (const [uniqueId] of groups) if (!ids.has(uniqueId)) issues.push({ code: 'SYMBOL_NOT_IN_NETLIST', uniqueId });
  for (const [uniqueId] of pcbById) if (!ids.has(uniqueId)) mismatches.push({ code: 'PCB_COMPONENT_NOT_IN_NETLIST', uniqueId });
  return { status: issues.length ? 'unknown' : mismatches.length ? 'mismatch'
      : !netlist.counts.pins ? 'empty' : pcb ? 'matched' : 'schematic_checked',
    matchedPinAssignments: matched.length, matched, mismatches, issues,
    multiUnitComponents: [...groups].filter(([,v]) => v.length > 1).map(([uniqueId,v]) => ({ uniqueId,
      designators: [...new Set(v.map(c => c.designator))], symbolInstances: v.length, subPartNames: v.map(c => c.subPartName ?? null) })),
    coverage: { logicalAssignmentsOnly: true, footprintGeometryCompared: false, copperConnectivityChecked: false, drcRun: false,
      electricalSuitabilityAssessed: false, note: 'Matching net names on pins and pads does not prove routed copper or circuit correctness.' } };
}

export function summarizeModel(result) {
  const { source, ...summary } = result;
  const records = [];
  try {
    for (const line of source.split('\n').filter(x => x.trim())) {
      const separator = line.indexOf('||');
      if (separator < 0) throw new Error('Unsupported record');
      const header = JSON.parse(line.slice(0, separator));
      let body = line.slice(separator + 2).trimEnd();
      if (body.endsWith('|')) body = body.slice(0, -1);
      records.push({ header, body: JSON.parse(body) });
    }
  } catch { return { ...summary, sourceSha256: digest(source), sourceFormat: 'unparsed', sourceCoverage: 'unknown' }; }
  const canvas = records.find(r => r.header.type === 'CANVAS')?.body;
  return { ...summary, sourceSha256: digest(source), sourceFormat: 'native pipe records',
    canvasOrigin: summary.canvasOrigin ?? (canvas ? { originX: canvas.originX ?? null, originY: canvas.originY ?? null } : null),
    recordCounts: Object.fromEntries([...new Set(records.map(r => r.header.type))].map(t => [t,records.filter(r => r.header.type === t).length])),
    sourceCoverage: 'terminal geometry via public APIs; raw source fingerprint retained' };
}

// Bounded 3.0 model reader. Returns native source coordinates, never a guessed
// footprint size or a replacement for an instance's frozen project model.
export function summarizeSourceModel(result) {
  const { source, ...summary } = result;
  const reject = (code, status = 'unknown') => ({ ...summary, status, code,
    sourceSha256: typeof source === 'string' ? digest(source) : null });
  if (typeof source !== 'string' || !source.length || source.length > 2 * 1024 * 1024)
    return reject('MODEL_SOURCE_UNAVAILABLE_OR_TOO_LARGE');
  const pcb = result.kind === 'footprint';
  if (!['symbol','footprint'].includes(result.kind) || !result.modelUuid || !result.libraryUuid
      || result.metadata?.uuid !== result.modelUuid || result.metadata?.libraryUuid !== result.libraryUuid
      || result.sourceApi !== (pcb ? 'eda.lib_Footprint.getDocumentSource' : 'eda.lib_Symbol.getDocumentSource')
      || !['current_project_library','requested_external_library'].includes(result.sourceScope))
    return reject('MODEL_SOURCE_IDENTITY_UNPROVEN');
  let rows;
  try { rows = parseNativeSource(source); } catch { return reject('MODEL_SOURCE_FORMAT_UNSUPPORTED','unsupported'); }
  const of = type => rows.filter(r => r.header.type === type);
  const head = of('DOCHEAD'), canvas = of('CANVAS');
  if (head.length !== 1 || rows[0] !== head[0] || head[0].body?.uuid !== result.modelUuid
      || head[0].body?.docType !== (pcb ? 'FOOTPRINT' : 'SYMBOL'))
    return reject('MODEL_SOURCE_TARGET_MISMATCH');
  if (rows.some(r => r.deleted)) return reject('MODEL_SOURCE_TOMBSTONES_UNSUPPORTED','unsupported');
  if (canvas.length !== 1 || ![canvas[0].body?.originX,canvas[0].body?.originY].every(Number.isFinite))
    return reject('MODEL_SOURCE_ORIGIN_UNPROVEN');
  const terminals = of(pcb ? 'PAD' : 'PIN'), parts = of('PART');
  if (!terminals.length || terminals.length > 1000) return reject('MODEL_PIN_COUNT_UNSUPPORTED','unsupported');
  if (!pcb && (parts.length !== 1 || !parts[0].header.id)) return reject('MODEL_MULTIPART_UNSUPPORTED','unsupported');
  const pins = [], ids = new Set(), numbers = new Set();
  const attr = (id, key) => {
    const found = of('ATTR').filter(r => r.body?.parentId === id && r.body.key === key);
    return found.length === 1 ? found[0].body.value : null;
  };
  for (const {header,body:b} of terminals) {
    if (!b || typeof header.id !== 'string' || !header.id || ids.has(header.id)) return reject('MODEL_TERMINAL_ID_AMBIGUOUS');
    ids.add(header.id);
    const number = pcb ? b.num : attr(header.id,'Pin Number');
    if (typeof number !== 'string' || !number || numbers.has(number)) return reject('MODEL_TERMINAL_NUMBER_AMBIGUOUS');
    numbers.add(number);
    if (pcb) {
      const d = b.defaultPad;
      const roundThrough = b.layerId === 12 && b.plated === true && b.padType === 'NORMAL'
        && b.hole?.holeType === 'ROUND' && Number.isFinite(b.hole.width) && b.hole.width > 0
        && b.hole.height === b.hole.width && b.hole.width < Math.min(d?.width,d?.height)
        && b.padOffsetX === 0 && b.padOffsetY === 0;
      if (![b.centerX,b.centerY,b.padAngle,b.padOffsetX,b.padOffsetY,d?.width,d?.height].every(Number.isFinite)
          || d.width <= 0 || d.height <= 0 || !['RECT','ELLIPSE','OVAL'].includes(d.padType)
          || !(roundThrough || b.hole === null && [1,2].includes(b.layerId))
          || !Array.isArray(b.specialPad) || b.specialPad.length
          || d.padType === 'RECT' && (!Number.isFinite(d.radius) || d.radius < 0))
        return reject('MODEL_PAD_GEOMETRY_UNSUPPORTED','unsupported');
      pins.push({id:header.id,number,name:null,x:b.centerX,y:b.centerY,rotation:b.padAngle,layer:b.layerId,
        padShape:d.padType === 'RECT' ? [d.padType,d.width,d.height,d.radius] : [d.padType,d.width,d.height],
        padOffset:{x:b.padOffsetX,y:b.padOffsetY},relativeAngle:b.relativeAngle ?? null,
        hole:roundThrough?['ROUND',b.hole.width]:null,sourceHole:b.hole,plated:b.plated??null,
        pinType:null,noConnected:null});
    } else {
      if (![b.x,b.y,b.rotation,b.length].every(Number.isFinite) || b.length < 0
          || b.partId !== parts[0].header.id || ![0,90,180,270].includes(b.rotation)
          || typeof b.display !== 'boolean' || typeof b.pinShape !== 'string')
        return reject('MODEL_PIN_GEOMETRY_UNSUPPORTED','unsupported');
      pins.push({id:header.id,number,name:attr(header.id,'Pin Name'),x:b.x,y:b.y,rotation:b.rotation,
        length:b.length,partId:b.partId,display:b.display,pinShape:b.pinShape,layer:null,padShape:null,hole:null,
        pinType:attr(header.id,'Pin Type'),noConnected:null});
    }
  }
  return { ...summary, status:'ok', pins, terminalBounds:null, canvasOrigin:canvas[0].body,
    sourceSha256:digest(source),sourceFormat:'native 3.0 pipe records',
    sourceVersion:{version:head[0].body.version ?? null,editVersion:head[0].body.editVersion ?? null},
    recordCounts:Object.fromEntries([...new Set(rows.map(r=>r.header.type))].map(t=>[t,of(t).length])),
    coordinates:pcb ? 'mil; native library source coordinates' : '10mil; native symbol source coordinates',
    coordinateSystem:{unit:pcb?'mil':'10mil',rotationUnit:'degrees',representation:'native source; no axis/angle transform applied'},
    persistenceVerified:false,sourceCoverage:'Explicit model/library metadata and DOCHEAD binding; terminal geometry from official source API',
    coverage:{mechanicalBodyBoundsVerified:false,model3dDimensionsVerified:false,
      projectInstanceOverridesResolved:false,deviceAssociationVerified:false,
      note:'May include unsaved worker content. Read the device association separately. External library data must not replace a frozen project-instance model; no save or design mutation was requested.'} };
}
