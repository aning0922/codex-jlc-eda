// Hand-authored ZIP structure: one empty stored file "a", ZIP64 directory metadata.
// Missing ZIP64 extra data is deliberately malformed. Never decompress it in the test runner.
export function zip64Fixture({extra=true}={}) {
 const localLength=31,extraLength=extra?28:0,centralLength=47+extraLength;
 const central=localLength,zip64=central+centralLength,locator=zip64+56,end=locator+20;
 const bytes=Buffer.alloc(end+22),u16=(at,n)=>bytes.writeUInt16LE(n,at),u32=(at,n)=>bytes.writeUInt32LE(n,at);
 u32(0,0x04034b50);u16(4,20);u16(26,1);bytes[30]=97;
 u32(central,0x02014b50);u16(central+4,45);u16(central+6,45);
 u32(central+20,0xffffffff);u32(central+24,0xffffffff);u16(central+28,1);u16(central+30,extraLength);u32(central+42,0xffffffff);bytes[central+46]=97;
 if(extra){u16(central+47,1);u16(central+49,24);} // Zero sizes and local offset in the 24-byte payload.
 u32(zip64,0x06064b50);u32(zip64+4,44);u16(zip64+12,45);u16(zip64+14,45);
 u32(zip64+24,1);u32(zip64+32,1);u32(zip64+40,centralLength);u32(zip64+48,central);
 u32(locator,0x07064b50);u32(locator+8,zip64);u32(locator+16,1);
 u32(end,0x06054b50);u16(end+8,0xffff);u16(end+10,0xffff);u32(end+12,centralLength);u32(end+16,0xffffffff);
 return new Uint8Array(bytes);
}
