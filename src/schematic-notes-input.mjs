import {z} from 'zod';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const noteChangesSchema=z.array(z.object({id,expectedText:z.string().min(1).max(1000),text:z.string().min(1).max(1000).optional(),atMm:z.array(z.number().finite().min(-5000).max(5000)).length(2).optional()}).strict().refine(p=>p.text!==undefined||p.atMm!==undefined,'Text or position required')).min(1).max(3).refine(p=>new Set(p.map(n=>n.id)).size===p.length,'Unique text IDs required');
export const notesPhases=['derive','read','recover','plan','schematic','complete','prepare_notes','adopt_notes','preview','verify','finish'];
