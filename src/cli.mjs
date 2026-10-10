import { JlcEdaAdapter } from './adapter.mjs';
const [command = 'doctor', json = '{}'] = process.argv.slice(2);
const aliases = { doctor: 'jlc_eda_doctor', sessions: 'jlc_eda_sessions',
  open: 'jlc_eda_open_project', inspect: 'jlc_eda_inspect_project', read: 'jlc_eda_read_document',
  search: 'jlc_eda_search_devices', device: 'jlc_eda_read_device', model: 'jlc_eda_read_library_model',
  connectivity: 'jlc_eda_read_connectivity' };
let input;
try { input = JSON.parse(json); }
catch { process.stderr.write('The second argument must be a JSON object.\n'); process.exit(2); }
const adapter=new JlcEdaAdapter();
let result;
try { result=await adapter.dispatch(aliases[command] || command, input); }
finally { const cleanup=await adapter.dispose();if(result&&(cleanup.cleanup.length||cleanup.retained.length))result.processCleanup=cleanup; }
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (result.status === 'failed') process.exitCode = 1;
