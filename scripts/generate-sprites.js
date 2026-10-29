import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const output = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
mkdirSync(output, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function chunk(type, data = Buffer.alloc(0)) {
  const name = Buffer.from(type);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, name, data, checksum]);
}
function sheet(width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  const put = (x, y, c) => {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    for (let n = 0; n < 4; n++) pixels[i + n] = c[n];
  };
  const rect = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c); };
  const line = (x0, y0, x1, y1, c) => {
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
    while (true) { put(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e = 2 * err; if (e >= dy) { err += dy; x0 += sx; } if (e <= dx) { err += dx; y0 += sy; } }
  };
  const ellipse = (x, y, rx, ry, c) => {
    for (let j = -ry; j <= ry; j++) for (let i = -rx; i <= rx; i++) if ((i / rx) ** 2 + (j / ry) ** 2 <= 1) put(x + i, y + j, c);
  };
  const save = (name) => {
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
    const rows = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) pixels.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
    writeFileSync(join(output, name), Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND')]));
    console.log(`${name}: ${width}x${height}`);
  };
  return { put, rect, line, ellipse, save };
}
const C = (hex, alpha = 255) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), alpha];
const ink = C('#080B10'), green = C('#00FF88'), emerald = C('#00AA55'), toxin = C('#004D25'), red = C('#FF0055');

// --- Spore: six 16px rows of directional viscous locomotion -----------------
// Row 0 idle, 1 slither down, 2 slither up, 3 slither side, 4 charge, 5 death.
// Forward is +x; the renderer flips only the side row when heading left.
{
  const s = sheet(96, 96);
  const mint = C('#8CFFC0'), pale = C('#C9FFE0');

  // Idle: a breathing droplet with the nucleus drifting inside the membrane.
  const idle = [[5, 4], [6, 5], [5, 5], [6, 4]];
  for (let f = 0; f < 4; f++) {
    const x = f * 16, [rx, ry] = idle[f];
    s.ellipse(x + 8, 9, rx, ry, ink);
    s.ellipse(x + 8, 9, rx - 1, ry - 1, emerald);
    s.ellipse(x + 8, 9, Math.max(1, rx - 2), Math.max(1, ry - 2), green);
    s.put(x + 6, 7, mint); s.put(x + 7, 6, pale);
    s.ellipse(x + 9, 9 + (f === 1 ? 1 : 0), 2, 2, toxin);
    s.put(x + 9, 9 + (f === 1 ? 1 : 0), red);
    s.put(x + 3, 5 + (f % 2), emerald); s.put(x + 13, 12 - (f % 2), emerald);
  }

  // Slither down (toward the camera): flattened puddle, nucleus low, three
  // rear tendrils dragging across the floor seams behind the body.
  for (let f = 0; f < 6; f++) {
    const x = f * 16, y = 16;
    const rx = [6, 7, 6, 7, 6, 7][f], ry = [4, 4, 5, 3, 4, 4][f];
    s.ellipse(x + 8, y + 10, rx, ry, ink);
    s.ellipse(x + 8, y + 10, rx - 1, ry - 1, emerald);
    s.ellipse(x + 8, y + 10, Math.max(1, rx - 1), Math.max(1, ry - 2), green);
    s.rect(x + 9 - rx, y + 10 + ry - 1, rx * 2 - 2, 1, emerald);
    s.ellipse(x + 8, y + 11, 2, 2, toxin); s.put(x + 8, y + 11, red);
    s.put(x + 6, y + 7, mint);
    for (let t = 0; t < 3; t++) {
      const sx = x + 5 + t * 3, wob = Math.round(Math.sin(f * 1.15 + t * 1.3) * 1.4);
      s.line(sx, y + 7, sx + wob, y + 3 + (t % 2), emerald);
      s.put(sx + wob, y + 3 + (t % 2), green);
    }
    if (f % 2 === 0) { s.put(x + 2, y + 13, green); s.put(x + 13, y + 14, emerald); }
  }

  // Slither up (away): a tapered teardrop cone, dorsal ridges contracting
  // upward while the rear skirt pushes off the floor.
  for (let f = 0; f < 6; f++) {
    const x = f * 16, y = 32, grow = 5 + (f % 2);
    for (let band = 0; band < 9; band++) {
      const hw = Math.max(1, Math.round(1 + Math.pow(1 - band / 8, 0.7) * grow));
      const sway = Math.round(Math.sin(f * 0.8 + band * 0.55) * 0.7);
      s.rect(x + 8 - hw + sway, y + 12 - band, hw * 2, 1, ink);
    }
    for (let band = 1; band < 8; band++) {
      const hw = Math.max(1, Math.round(Math.pow(1 - band / 8, 0.7) * grow));
      const sway = Math.round(Math.sin(f * 0.8 + band * 0.55) * 0.7);
      s.rect(x + 8 - hw + sway, y + 12 - band, hw * 2, 1, band % 3 === 0 ? green : emerald);
    }
    s.put(x + 8, y + 11, toxin); s.put(x + 8, y + 10, red); s.put(x + 8, y + 3, green);
    s.put(x + 3 + (f % 2), y + 13, green); s.put(x + 12 - (f % 2), y + 14, emerald);
  }

  // Slither side: an extreme horizontal stretch with snap-back recoil and
  // micro-droplets trailing off the tail.
  for (let f = 0; f < 6; f++) {
    const x = f * 16, y = 48;
    const rx = [6, 7, 5, 7, 6, 7][f], ry = [3, 3, 2, 3, 3, 2][f];
    s.ellipse(x + 8, y + 9, rx, ry, ink);
    s.ellipse(x + 8, y + 9, rx - 1, ry - 1, emerald);
    s.ellipse(x + 8, y + 9, Math.max(1, rx - 2), Math.max(1, ry - 1), green);
    s.put(x + 8 + rx, y + 9, green);
    s.put(x + 7, y + 8, mint); s.put(x + 9, y + 8, pale);
    s.ellipse(x + 8 + Math.round(rx * 0.4), y + 9, 2, 1, toxin);
    s.put(x + 8 + Math.round(rx * 0.4), y + 9, red);
    s.line(x + 8 - rx, y + 9, x + Math.max(1, 6 - rx), y + 8 + (f % 2), emerald);
    s.put(x + 1 + (f % 2), y + 12, green);
    if (f % 2 === 0) s.put(x + 3, y + 13, emerald);
  }

  // Charge / drill: the body coils while tendrils spin toward the target.
  for (let f = 0; f < 4; f++) {
    const x = f * 16, y = 64;
    s.ellipse(x + 5, y + 9, 4, 4, ink);
    s.ellipse(x + 5, y + 9, 3, 3, emerald);
    s.ellipse(x + 5, y + 9, 2, 2, green);
    s.put(x + 5, y + 9, red);
    for (let t = -1; t <= 1; t++) {
      const oy = Math.round(Math.sin(f * Math.PI / 2 + t * 1.1) * 2.4);
      s.line(x + 7, y + 9 + t, x + 13, y + 9 + oy, emerald);
    }
    s.put(x + 14, y + 9, mint); s.put(x + 13, y + 8, green); s.put(x + 13, y + 10, green);
    s.put(x + 2, y + 13, emerald);
  }

  // Death: the membrane ruptures, splashes, then dissolves into a puddle.
  const pop = [[7, 5], [6, 3], [5, 2], [4, 1]];
  for (let f = 0; f < 4; f++) {
    const x = f * 16, y = 80, [rx, ry] = pop[f];
    if (f === 0) {
      s.ellipse(x + 8, y + 8, rx, ry, ink);
      s.ellipse(x + 8, y + 8, rx - 1, ry - 1, green);
      s.ellipse(x + 8, y + 8, 2, 2, red);
      for (const [dx, dy] of [[-7, -4], [7, -4], [-7, 3], [7, 3]]) s.put(x + 8 + dx, y + 8 + dy, emerald);
    } else if (f === 1) {
      s.ellipse(x + 8, y + 9, rx, ry, emerald);
      s.ellipse(x + 8, y + 9, rx - 2, Math.max(1, ry - 1), green);
      for (const [dx, dy] of [[-7, -3], [7, -2], [-5, 4], [6, 3]]) s.put(x + 8 + dx, y + 9 + dy, green);
    } else if (f === 2) {
      s.ellipse(x + 8, y + 12, 6, 2, emerald);
      s.rect(x + 3, y + 12, 10, 1, toxin);
      s.put(x + 2, y + 10, green); s.put(x + 13, y + 10, emerald);
    } else {
      s.rect(x + 4, y + 13, 8, 1, toxin);
      s.put(x + 3, y + 12, emerald); s.put(x + 12, y + 12, emerald);
    }
  }
  s.save('spore.png');
}
{
  const s = sheet(64, 64), armor = C('#3A4454'), uniform = C('#8CA0BA'), visor = C('#FFCC00'), flesh = C('#FFB088'), flash = C('#FFF066');
  const guard = (f, row, bob, leg, recoil, muzzle) => {
    const x = f * 16, y = row * 16 + bob;
    s.rect(x + 4, y + 11, 3, 3, ink); s.rect(x + 9, y + 11, 3, 3, ink);
    s.rect(x + 4 + leg, y + 11, 2, 3, armor); s.rect(x + 9 - leg, y + 11, 2, 3, armor);
    s.rect(x + 3, y + 6, 10, 6, ink); s.rect(x + 4, y + 7, 8, 4, armor); s.rect(x + 5, y + 7, 4, 2, uniform);
    s.rect(x + 5, y + 1, 7, 6, ink); s.rect(x + 6, y + 2, 5, 4, armor); s.rect(x + 9, y + 3, 3, 1, visor); s.put(x + 10, y + 5, flesh);
    s.rect(x + 8 - recoil, y + 8, 7, 2, ink); s.rect(x + 9 - recoil, y + 8, 5, 1, uniform);
    if (muzzle) { s.put(x + 15, y + 7, flash); s.put(x + 15, y + 9, flash); s.put(x + 14, y + 8, flash); }
  };
  for (let f = 0; f < 4; f++) guard(f, 0, f === 1 || f === 2 ? 1 : 0, 0, 0, false);
  for (let f = 0; f < 4; f++) guard(f, 1, 0, [1,0,-1,0][f], 0, false);
  guard(0, 2, 0, 0, 2, true); guard(1, 2, 0, 0, 0, false);
  for (let f = 0; f < 3; f++) {
    const x = f * 16, y = 48;
    if (f === 0) guard(f, 3, 1, 1, 0, false);
    else { s.rect(x + 2, y + 10 + f, 12, 3, ink); s.rect(x + 4, y + 10 + f, 8, 2, armor); s.rect(x + 10, y + 9 + f, 4, 3, uniform); s.put(x + 13, y + 10 + f, visor); }
  }
  s.save('guard.png');
}
{
  const s = sheet(72,96), flesh = red, muscle = C('#880022'), bone = C('#E8E8E8'), eye = C('#FFEE00');
  const beast = (f,row,pose) => {
    const x = f * 24, y = row * 24, shift = pose === 'coil' ? -2 : pose === 'lunge' ? 2 : 0, bob = f % 2;
    s.ellipse(x + 10 + shift, y + 13 + bob, 7, 5, ink); s.ellipse(x + 10 + shift, y + 13 + bob, 6, 4, muscle);
    s.line(x + 5 + shift, y + 12, x + 12 + shift, y + 9, flesh); s.line(x + 6 + shift, y + 15, x + 13 + shift, y + 13, flesh);
    s.ellipse(x + 16 + shift, y + 10 + bob, 4, 4, ink); s.ellipse(x + 16 + shift, y + 10 + bob, 3, 3, flesh); s.put(x + 18 + shift, y + 9 + bob, eye);
    s.line(x + 6 + shift, y + 16, x + 3 + shift, y + 20, muscle); s.line(x + 12 + shift, y + 17, x + 13 + shift, y + 21, flesh);
    s.line(x + 16 + shift, y + 14, x + 20 + shift, y + 18 - (f % 2), flesh); s.line(x + 20 + shift, y + 18 - (f % 2), x + 22 + shift, y + 16 - (f % 2), bone);
    if (pose === 'lunge') { s.line(x + 2, y + 19, x + 16, y + 4 + f, bone); s.line(x + 5, y + 21, x + 18, y + 6 + f, flesh); }
    if (pose === 'coil') s.put(x + 17 + shift, y + 8, eye);
  };
  for (let f = 0; f < 3; f++) beast(f,0,'stalk');
  for (let f = 0; f < 3; f++) beast(f,1,'coil');
  for (let f = 0; f < 2; f++) beast(f,2,'lunge');
  for (let f = 0; f < 2; f++) beast(f,3,'recover');
  s.save('chimera.png');
}
{
  const s = sheet(128,64), p = { v:C('#0A0D14'), sh:C('#10141E'), mid:C('#181E2B'), seam:C('#242D3F'), rivet:C('#34425A'), front:C('#1A1F2C'), top:C('#2E384C'), edge:C('#4A5A78'), yellow:C('#D4A017'), black:C('#1A1A1A'), vent:C('#004D28'), led:green };
  const tile = (col,row,fn) => fn(col*16,row*16);
  for (let col = 0; col < 5; col++) tile(col,0,(x,y) => {
    s.rect(x,y,16,16,p.sh); s.rect(x+1,y+1,14,14,p.mid); s.line(x+1,y+1,x+14,y+1,p.seam);
    if (col === 1) for (const dx of [2,13]) for (const dy of [2,13]) s.put(x+dx,y+dy,p.rivet);
    if (col === 2) { s.rect(x+2,y+3,12,10,p.v); for (let i=4;i<13;i+=3) { s.line(x+3,y+i,x+12,y+i,p.vent); s.line(x+3,y+i+1,x+12,y+i+1,p.rivet); } }
    if (col === 3) { s.line(x+3,y+3,x+7,y+8,p.sh); s.line(x+7,y+8,x+6,y+11,p.sh); s.line(x+7,y+8,x+12,y+10,p.seam); }
    if (col === 4) for (let i=0;i<16;i++) for(let j=0;j<4;j++) s.put(x+i,y+j,((i+j)>>2)%2?p.yellow:p.black);
  });
  tile(0,1,(x,y)=>{ s.rect(x,y,16,16,p.top); s.line(x,y,x+15,y,p.edge); s.line(x,y+15,x+15,y+15,p.sh); for(let i=3;i<16;i+=8)s.put(x+i,y+3,p.rivet); });
  tile(1,1,(x,y)=>{ s.rect(x,y,16,16,p.front); s.rect(x+1,y,2,16,p.sh); s.rect(x+12,y,2,16,p.seam); s.line(x,y+14,x+15,y+14,p.sh); });
  for (const col of [2,3]) tile(col,1,(x,y)=>{ s.rect(x,y,16,16,p.front); s.rect(x+(col===2?0:12),y,4,16,p.top); s.line(x,y,x+15,y,p.edge); s.line(x,y+15,x+15,y+15,p.sh); });
  tile(4,1,(x,y)=>{ for(let j=0;j<16;j++) s.rect(x,y+j,16,1,[0,0,0,Math.round(153*(1-j/15))]); });
  tile(0,2,(x,y)=>{ s.rect(x+1,y+1,14,14,p.sh); s.rect(x+2,y+2,12,12,p.top); for(let i=3;i<13;i++){s.put(x+i,y+i,p.edge); s.put(x+15-i,y+i,p.edge);} s.rect(x+2,y+2,12,1,p.edge); });
  tile(1,2,(x,y)=>{ s.rect(x+3,y+2,10,12,p.sh); s.rect(x+4,y+3,8,10,p.top); s.rect(x+3,y+4,10,1,p.edge); s.rect(x+3,y+11,10,1,p.edge); s.put(x+8,y+7,p.led); s.put(x+7,y+8,p.led); s.put(x+9,y+8,p.led); s.put(x+8,y+9,p.led); });
  tile(2,2,(x,y)=>{ s.rect(x+1,y+1,14,14,p.sh); s.rect(x+2,y+2,12,12,p.top); s.rect(x+4,y+4,8,8,p.front); s.line(x+2,y+2,x+13,y+2,p.edge); });
  tile(0,3,(x,y)=>{ s.rect(x,y,16,16,p.sh); s.rect(x+2,y,12,16,p.v); s.rect(x,y,2,16,p.top); s.rect(x+14,y,2,16,p.top); s.put(x+1,y+3,p.led); s.put(x+14,y+12,p.led); });
  tile(1,3,(x,y)=>{ s.rect(x,y,16,16,p.front); s.rect(x+1,y+1,14,14,p.top); s.line(x+8,y+1,x+8,y+14,p.sh); for(let i=2;i<14;i+=4){ s.rect(x+2,y+i,3,1,p.yellow); s.rect(x+11,y+i,3,1,p.yellow); } s.line(x,y,x+15,y,p.edge); });
  s.save('tileset.png');
}
// Dungeon interactables, one 16px cell each: altar, chest, portal, telegraph, vat.
{
  const s=sheet(80,16), dark=C('#10141E'), metal=C('#34425A'), bright=C('#4A5A78'), yellow=C('#D4A017'), cyan=C('#00E5FF');
  s.rect(2,9,12,6,ink); s.rect(3,10,10,4,metal); s.rect(6,2,4,8,metal); s.rect(7,3,2,5,green); s.rect(4,5,8,2,green);
  s.rect(18,5,12,10,ink); s.rect(19,6,10,8,metal); s.rect(19,6,10,2,bright); s.rect(23,7,2,4,green);
  s.ellipse(40,8,7,7,metal); s.ellipse(40,8,5,5,green); s.ellipse(40,8,3,3,dark); s.put(42,7,cyan);
  s.ellipse(56,8,7,7,red); s.ellipse(56,8,5,5,dark); s.line(56,1,56,15,red); s.line(49,8,63,8,green); s.put(56,8,yellow);
  s.rect(66,2,12,13,ink); s.rect(67,3,10,11,metal); s.rect(69,4,6,8,green); s.rect(71,5,2,5,dark); s.rect(67,13,10,1,bright);
  s.save('dungeon.png');
}
// A 24px heavy enforcer sheet with the shield integrated into the silhouette.
{
  const s=sheet(96,96), armor=C('#3A4454'), plate=C('#8CA0BA'), amber=C('#FFCC00'), flash=C('#FFF066');
  for(let row=0;row<4;row++) for(let f=0;f<(row===2?2:row===3?3:4);f++) {
    const x=f*24,y=row*24,bob=row===0&&f%2?1:0;
    if(row===3&&f>0){s.rect(x+4,y+18,17,4,ink);s.rect(x+5,y+19,14,2,armor);continue;}
    s.rect(x+4,y+9+bob,15,10,ink);s.rect(x+5,y+10+bob,13,8,armor);s.rect(x+6,y+10+bob,8,3,plate);
    s.rect(x+8,y+2+bob,9,8,ink);s.rect(x+9,y+3+bob,7,6,armor);s.rect(x+13,y+5+bob,4,2,amber);
    s.rect(x+5+(row===1?f%2:0),y+18+bob,4,4,ink);s.rect(x+13-(row===1?f%2:0),y+18+bob,4,4,ink);
    s.rect(x+18,y+7+bob,5,14,ink);s.rect(x+19,y+8+bob,3,12,plate);s.rect(x+20,y+9+bob,1,10,amber);
    if(row===2&&f===0){s.put(x+23,y+10,flash);s.put(x+23,y+12,flash);}
  }
  s.save('enforcer.png');
}
// Props: crate, barrel, chest, altar, portal, drone intact/broken, vat, telegraph.
{
  const s=sheet(144,16), dark=C('#10141E'), steel=C('#34425A'), light=C('#8CA0BA'), amber=C('#FFCC00');
  s.rect(1,1,14,14,ink);s.rect(2,2,12,12,steel);for(let i=3;i<13;i++){s.put(i,i,light);s.put(15-i,i,light);}
  s.rect(19,1,10,14,ink);s.rect(20,2,8,12,steel);s.rect(19,4,10,1,light);s.rect(19,11,10,1,light);s.rect(23,6,2,4,green);
  s.rect(34,5,12,10,ink);s.rect(35,6,10,8,steel);s.rect(35,6,10,2,light);s.rect(39,7,2,4,green);
  s.rect(50,9,12,6,ink);s.rect(51,10,10,4,steel);s.rect(54,2,4,8,steel);s.rect(55,3,2,5,green);s.rect(52,5,8,2,green);
  s.ellipse(72,8,7,7,steel);s.ellipse(72,8,5,5,green);s.ellipse(72,8,3,3,dark);s.put(74,7,light);
  s.ellipse(88,8,7,6,ink);s.ellipse(88,8,6,5,steel);s.ellipse(88,8,3,3,amber);s.put(88,8,red);s.line(83,13,81,15,steel);s.line(93,13,95,15,steel);
  s.ellipse(104,9,7,4,ink);s.ellipse(104,9,6,3,steel);s.line(99,6,109,13,amber);
  s.rect(114,2,12,13,ink);s.rect(115,3,10,11,steel);s.rect(117,4,6,8,green);s.rect(119,5,2,5,dark);
  s.ellipse(136,8,7,7,red);s.ellipse(136,8,5,5,dark);s.line(136,1,136,15,red);s.line(129,8,143,8,green);
  s.save('props.png');
}
{
  const s=sheet(32,8), white=C('#FFFDF4'), enemy=C('#FF8B7A');
  s.rect(1,3,13,2,green);s.rect(8,2,6,4,white);
  s.rect(17,3,13,2,enemy);s.rect(24,2,6,4,white);
  s.save('projectiles.png');
}

// Modular 4-way rigs. Rows 0-3 are idle, walk down, walk up and walk side;
// rows 4-5 (plus 6 on the chimera) are the action pair, then the articulated
// head and the 360-degree weapon sit in the final two rows.
function makeRig(kind, size) {
  const rows = kind === 'mutant' ? 9 : 8;
  const s = sheet(size * 4, size * rows), u = size / 20;
  const R = (x, y, w, h, c) => s.rect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), c);
  const E = (x, y, rx, ry, c) => s.ellipse(Math.round(x), Math.round(y), Math.max(1, Math.round(rx)), Math.max(1, Math.round(ry)), c);
  const L = (x, y, x2, y2, c) => s.line(Math.round(x), Math.round(y), Math.round(x2), Math.round(y2), c);

  const navy = C('#1B263B'), white = C('#DCEEF8'), blue = C('#78A8C8'), cyan = C('#00F5FF');
  const yellow = C('#FFB703'), charcoal = C('#2B2D42'), orange = C('#FF4D00');
  // Bruised violet flesh, near-black muscle, ivory bone and toxic spine light.
  const flesh = C('#7A1C4B'), purple = C('#4A0E2E'), bone = C('#F0EAD6');

  // --- Hazmat trooper: clean white carapace, navy joints, cyan visor. --------
  const guardBody = (ox, oy, f, view) => {
    const step = [0, 1, 0, -1][f];
    if (view === 'front') {
      R(ox + 4 * u, oy + (13 + (f % 2)) * u, 4 * u, 4 * u, blue);
      R(ox + 12 * u, oy + (13 + ((f + 1) % 2)) * u, 4 * u, 4 * u, blue);
      R(ox + 3.5 * u, oy + 16.5 * u, 5 * u, 3.5 * u, navy);
      R(ox + 11.5 * u, oy + 16.5 * u, 5 * u, 3.5 * u, navy);
      R(ox + 3 * u, oy + 6 * u, 14 * u, 8 * u, ink);
      R(ox + 4 * u, oy + 7 * u, 12 * u, 6 * u, white);
      R(ox + 6 * u, oy + 8 * u, 8 * u, 3 * u, blue);
      R(ox + 4 * u, oy + 12 * u, 12 * u, 1.5 * u, navy);
      R(ox + 2 * u, oy + 7 * u, 2.5 * u, 6 * u, white);
      R(ox + 15.5 * u, oy + 7 * u, 2.5 * u, 6 * u, white);
      R(ox + 5.5 * u, oy + 7 * u, 2 * u, 1 * u, blue);
      R(ox + 12.5 * u, oy + 7 * u, 2 * u, 1 * u, blue);
    } else if (view === 'back') {
      R(ox + 4 * u, oy + (13 + (f % 2)) * u, 4 * u, 4 * u, blue);
      R(ox + 12 * u, oy + (13 + ((f + 1) % 2)) * u, 4 * u, 4 * u, blue);
      R(ox + 3.5 * u, oy + 16.5 * u, 5 * u, 3.5 * u, navy);
      R(ox + 11.5 * u, oy + 16.5 * u, 5 * u, 3.5 * u, navy);
      R(ox + 3 * u, oy + 6 * u, 14 * u, 8 * u, ink);
      R(ox + 4 * u, oy + 7 * u, 12 * u, 6 * u, white);
      R(ox + 7 * u, oy + 7 * u, 6 * u, 5 * u, navy);
      R(ox + 8 * u, oy + 8 * u, 4 * u, 3 * u, blue);
      R(ox + 4 * u, oy + 12 * u, 12 * u, 1.5 * u, blue);
      R(ox + 2 * u, oy + 7 * u, 2.5 * u, 6 * u, white);
      R(ox + 15.5 * u, oy + 7 * u, 2.5 * u, 6 * u, white);
      s.put(ox + 10 * u, oy + 9 * u, cyan);
    } else {
      R(ox + 3.5 * u, oy + 7 * u, 3 * u, 5 * u, navy);
      R(ox + 4.5 * u, oy + 8 * u, 2 * u, 3 * u, blue);
      R(ox + 5 * u, oy + 6 * u, 10 * u, 8 * u, ink);
      R(ox + 6 * u, oy + 7 * u, 9 * u, 6 * u, white);
      R(ox + 11 * u, oy + 8 * u, 4 * u, 3 * u, blue);
      R(ox + 5 * u, oy + 12 * u, 10 * u, 1.5 * u, navy);
      R(ox + 12 * u, oy + 8 * u, 3 * u, 4 * u, white);
      R(ox + (7 + step) * u, oy + 13 * u, 3.5 * u, 4 * u, blue);
      R(ox + (11 - step) * u, oy + 13 * u, 3.5 * u, 4 * u, blue);
      R(ox + (6.5 + step) * u, oy + 16.5 * u, 4 * u, 3.5 * u, navy);
      R(ox + (10.5 - step) * u, oy + 16.5 * u, 4 * u, 3.5 * u, navy);
    }
  };

  // Idle breath: the torso drops 1px while the boots stay welded to the floor.
  const guardIdle = (ox, oy, f) => {
    const dip = f === 1 || f === 2 ? 1 : 0;
    R(ox + 4 * u, oy + 18 * u, 4 * u, 2 * u, navy);
    R(ox + 12 * u, oy + 18 * u, 4 * u, 2 * u, navy);
    R(ox + 4.5 * u, oy + 17.5 * u, 3 * u, 1 * u, blue);
    R(ox + 12.5 * u, oy + 17.5 * u, 3 * u, 1 * u, blue);
    const knee = dip ? 0.6 : 0;
    R(ox + (5 - knee) * u, oy + (13 + dip) * u, 3.4 * u, 4.6 * u, blue);
    R(ox + (11.6 + knee) * u, oy + (13 + dip) * u, 3.4 * u, 4.6 * u, blue);
    R(ox + 3 * u, oy + (6 + dip) * u, 14 * u, 8 * u, ink);
    R(ox + 4 * u, oy + (7 + dip) * u, 12 * u, 6 * u, white);
    R(ox + 6 * u, oy + (8 + dip) * u, 8 * u, 3 * u, blue);
    R(ox + 4 * u, oy + (12 + dip) * u, 12 * u, 1.5 * u, navy);
    R(ox + 2 * u, oy + (7 + dip) * u, 2.5 * u, 6 * u, white);
    R(ox + 15.5 * u, oy + (7 + dip) * u, 2.5 * u, 6 * u, white);
    R(ox + 5.5 * u, oy + (7 + dip) * u, 2 * u, 1 * u, blue);
    R(ox + 12.5 * u, oy + (7 + dip) * u, 2 * u, 1 * u, blue);
  };

  // --- Exo-juggernaut: hazard yellow plates over a charcoal frame. ----------
  const enforcerBody = (ox, oy, f, view) => {
    const step = [0, 1, 0, -1][f];
    if (view === 'front') {
      R(ox + 3 * u, oy + 13 * u, 6 * u, 5 * u, charcoal);
      R(ox + 11 * u, oy + 13 * u, 6 * u, 5 * u, charcoal);
      R(ox + 2.5 * u, oy + 17 * u, 6 * u, 3 * u, ink);
      R(ox + 11.5 * u, oy + 17 * u, 6 * u, 3 * u, ink);
      R(ox + 3 * u, oy + 6 * u, 14 * u, 8 * u, ink);
      R(ox + 4 * u, oy + 7 * u, 12 * u, 6 * u, charcoal);
      R(ox + 6 * u, oy + 8 * u, 8 * u, 3 * u, yellow);
      R(ox + 4 * u, oy + 12 * u, 12 * u, 1.5 * u, ink);
      R(ox + 1 * u, oy + 5 * u, 5 * u, 6 * u, yellow);
      R(ox + 14 * u, oy + 5 * u, 5 * u, 6 * u, yellow);
      R(ox + 1 * u, oy + 5 * u, 5 * u, 1.5 * u, white);
      R(ox + 14 * u, oy + 5 * u, 5 * u, 1.5 * u, orange);
    } else if (view === 'back') {
      R(ox + 3 * u, oy + 13 * u, 6 * u, 5 * u, charcoal);
      R(ox + 11 * u, oy + 13 * u, 6 * u, 5 * u, charcoal);
      R(ox + 2.5 * u, oy + 17 * u, 6 * u, 3 * u, ink);
      R(ox + 11.5 * u, oy + 17 * u, 6 * u, 3 * u, ink);
      R(ox + 3 * u, oy + 6 * u, 14 * u, 8 * u, ink);
      R(ox + 4 * u, oy + 7 * u, 12 * u, 6 * u, charcoal);
      R(ox + 7 * u, oy + 6 * u, 6 * u, 6 * u, ink);
      R(ox + 8 * u, oy + 7 * u, 4 * u, 4 * u, charcoal);
      R(ox + 8 * u, oy + 8 * u, 1.5 * u, 2 * u, orange);
      R(ox + 10.5 * u, oy + 8 * u, 1.5 * u, 2 * u, orange);
      R(ox + 1 * u, oy + 5 * u, 5 * u, 6 * u, yellow);
      R(ox + 14 * u, oy + 5 * u, 5 * u, 6 * u, yellow);
      R(ox + 1 * u, oy + 5 * u, 5 * u, 1.5 * u, white);
      R(ox + 14 * u, oy + 5 * u, 5 * u, 1.5 * u, orange);
    } else {
      R(ox + 3 * u, oy + 7 * u, 4 * u, 6 * u, charcoal);
      R(ox + 2 * u, oy + 5 * u, 5 * u, 4 * u, yellow);
      R(ox + 2 * u, oy + 5 * u, 5 * u, 1.5 * u, white);
      R(ox + 5 * u, oy + 6 * u, 10 * u, 8 * u, ink);
      R(ox + 6 * u, oy + 7 * u, 9 * u, 6 * u, charcoal);
      R(ox + 11 * u, oy + 8 * u, 4 * u, 3 * u, yellow);
      R(ox + (6 + step) * u, oy + 13 * u, 5 * u, 4.5 * u, charcoal);
      R(ox + (11 - step) * u, oy + 13 * u, 5 * u, 4.5 * u, charcoal);
      R(ox + (5.5 + step) * u, oy + 17 * u, 5 * u, 3 * u, ink);
      R(ox + (10.5 - step) * u, oy + 17 * u, 5 * u, 3 * u, ink);
    }
  };

  const enforcerIdle = (ox, oy, f) => {
    // 0.6 design units is exactly one source pixel in the 32px cell.
    const dip = f === 1 || f === 2 ? 0.6 : 0;
    R(ox + 2.5 * u, oy + 18 * u, 6 * u, 2 * u, ink);
    R(ox + 11.5 * u, oy + 18 * u, 6 * u, 2 * u, ink);
    R(ox + 3 * u, oy + 17.5 * u, 5 * u, 1 * u, charcoal);
    R(ox + 12 * u, oy + 17.5 * u, 5 * u, 1 * u, charcoal);
    const knee = dip ? 0.8 : 0;
    R(ox + (3 - knee) * u, oy + (13 + dip) * u, 5.4 * u, 4.6 * u, charcoal);
    R(ox + (11.6 + knee) * u, oy + (13 + dip) * u, 5.4 * u, 4.6 * u, charcoal);
    R(ox + 3 * u, oy + (6 + dip) * u, 14 * u, 8 * u, ink);
    R(ox + 4 * u, oy + (7 + dip) * u, 12 * u, 6 * u, charcoal);
    R(ox + 6 * u, oy + (8 + dip) * u, 8 * u, 3 * u, yellow);
    R(ox + 4 * u, oy + (12 + dip) * u, 12 * u, 1.5 * u, ink);
    R(ox + 1 * u, oy + (5 + dip) * u, 5 * u, 6 * u, yellow);
    R(ox + 14 * u, oy + (5 + dip) * u, 5 * u, 6 * u, yellow);
    R(ox + 1 * u, oy + (5 + dip) * u, 5 * u, 1.5 * u, white);
    R(ox + 14 * u, oy + (5 + dip) * u, 5 * u, 1.5 * u, orange);
  };

  // --- Chimera: low-slung quadrupedal stalker. ------------------------------
  // Elongated torso, exposed ribs, green spine blisters and scythe forearms
  // folded back along the flanks. Feet stay planted on the idle row.
  const chimeraSide = (ox, oy, f, idle) => {
    const dip = idle && (f === 1 || f === 2) ? 1 : 0;
    const step = idle ? 0 : [0, 1, 0, -1][f];
    E(ox + 9 * u, oy + (11 + dip) * u, 6.5 * u, 3.2 * u, ink);
    E(ox + 9 * u, oy + (11 + dip) * u, 5.8 * u, 2.6 * u, purple);
    E(ox + 8.5 * u, oy + (10.2 + dip) * u, 5 * u, 1.9 * u, flesh);
    E(ox + 5 * u, oy + (9 + dip) * u, 3.2 * u, 2.6 * u, ink);
    E(ox + 5 * u, oy + (9 + dip) * u, 2.6 * u, 2 * u, flesh);
    E(ox + 3.6 * u, oy + (6.8 + dip) * u, 1.4 * u, 1.4 * u, green);
    E(ox + 6.4 * u, oy + (6.2 + dip) * u, 1.6 * u, 1.4 * u, green);
    E(ox + 9.2 * u, oy + (6.4 + dip) * u, 1.2 * u, 1.2 * u, green);
    E(ox + 12 * u, oy + (7.4 + dip) * u, 1.2 * u, 1.2 * u, green);
    for (let i = 0; i < 3; i++) {
      L(ox + (8.5 + i * 1.8) * u, oy + (10 + dip) * u, ox + (8 + i * 1.8) * u, oy + (14 + dip) * u, bone);
      L(ox + (9.2 + i * 1.8) * u, oy + (13.6 + dip) * u, ox + (10.1 + i * 1.8) * u, oy + (13.6 + dip) * u, bone);
    }
    L(ox + 6 * u, oy + (12.6 + dip) * u, ox + (5 + step * 0.6) * u, oy + 19 * u, flesh);
    L(ox + 7 * u, oy + (12.6 + dip) * u, ox + (7.4 - step * 0.6) * u, oy + 19 * u, purple);
    L(ox + 13 * u, oy + (12.4 + dip) * u, ox + (12.4 + step) * u, oy + 19 * u, flesh);
    L(ox + 14 * u, oy + (12.4 + dip) * u, ox + (15 - step) * u, oy + 19 * u, purple);
    L(ox + (14 + step * 0.4) * u, oy + (10 + dip) * u, ox + 7 * u, oy + (6.6 + dip) * u, bone);
    L(ox + (13 + step * 0.4) * u, oy + (10.4 + dip) * u, ox + 8 * u, oy + (7.4 + dip) * u, flesh);
    L(ox + (14 - step * 0.4) * u, oy + (12 + dip) * u, ox + 7.5 * u, oy + (16 + dip) * u, bone);
    L(ox + (13 - step * 0.4) * u, oy + (11.6 + dip) * u, ox + 8.5 * u, oy + (15 + dip) * u, flesh);
  };

  const chimeraFront = (ox, oy, f) => {
    const step = [0, 1, 0, -1][f];
    E(ox + 10 * u, oy + 11 * u, 6 * u, 2.8 * u, ink);
    E(ox + 10 * u, oy + 11 * u, 5.2 * u, 2.2 * u, purple);
    E(ox + 10 * u, oy + 10 * u, 4 * u, 1.6 * u, flesh);
    E(ox + 4 * u, oy + 9 * u, 2.8 * u, 2.2 * u, flesh);
    E(ox + 16 * u, oy + 9 * u, 2.8 * u, 2.2 * u, flesh);
    E(ox + 5 * u, oy + 6.4 * u, 1.4 * u, 1.4 * u, green);
    E(ox + 15 * u, oy + 6.4 * u, 1.4 * u, 1.4 * u, green);
    for (let i = 0; i < 3; i++) L(ox + (8 + i * 2) * u, oy + 9.5 * u, ox + (7.4 + i * 2) * u, oy + 13 * u, bone);
    L(ox + 4 * u, oy + 12 * u, ox + (2 + step * 0.4) * u, oy + 19 * u, flesh);
    L(ox + 16 * u, oy + 12 * u, ox + (18 - step * 0.4) * u, oy + 19 * u, flesh);
    L(ox + 7 * u, oy + 12.5 * u, ox + 6.5 * u, oy + 19 * u, purple);
    L(ox + 13 * u, oy + 12.5 * u, ox + 13.5 * u, oy + 19 * u, purple);
    L(ox + 2 * u, oy + 19 * u, ox + 0.5 * u, oy + 14 * u, bone);
    L(ox + 18 * u, oy + 19 * u, ox + 19.5 * u, oy + 14 * u, bone);
  };

  const chimeraBack = (ox, oy, f) => {
    const step = [0, 1, 0, -1][f];
    E(ox + 10 * u, oy + 11 * u, 6 * u, 2.8 * u, ink);
    E(ox + 10 * u, oy + 11 * u, 5.2 * u, 2.2 * u, purple);
    E(ox + 10 * u, oy + 5.6 * u, 1.6 * u, 1.2 * u, green);
    E(ox + 10 * u, oy + 8 * u, 2.2 * u, 1.8 * u, green);
    E(ox + 10 * u, oy + 10.6 * u, 1.8 * u, 1.4 * u, green);
    E(ox + 4 * u, oy + 9 * u, 2.6 * u, 2 * u, flesh);
    E(ox + 16 * u, oy + 9 * u, 2.6 * u, 2 * u, flesh);
    L(ox + 6 * u, oy + 9.5 * u, ox + 8 * u, oy + 13 * u, bone);
    L(ox + 14 * u, oy + 9.5 * u, ox + 12 * u, oy + 13 * u, bone);
    L(ox + 5 * u, oy + 12.5 * u, ox + (3 + step * 0.4) * u, oy + 19 * u, purple);
    L(ox + 15 * u, oy + 12.5 * u, ox + (17 - step * 0.4) * u, oy + 19 * u, purple);
    L(ox + 7.5 * u, oy + 13 * u, ox + 7 * u, oy + 19 * u, flesh);
    L(ox + 12.5 * u, oy + 13 * u, ox + 13 * u, oy + 19 * u, flesh);
    L(ox + 3 * u, oy + 19 * u, ox + 1.5 * u, oy + 14 * u, bone);
    L(ox + 17 * u, oy + 19 * u, ox + 18.5 * u, oy + 14 * u, bone);
  };

  const bodyOf = (ox, oy, f, view) => {
    if (kind === 'guard') { if (view === 'idle') guardIdle(ox, oy, f); else guardBody(ox, oy, f, view); }
    else if (kind === 'enforcer') { if (view === 'idle') enforcerIdle(ox, oy, f); else enforcerBody(ox, oy, f, view); }
    else if (view === 'idle' || view === 'side') chimeraSide(ox, oy, f, view === 'idle');
    else if (view === 'front') chimeraFront(ox, oy, f);
    else chimeraBack(ox, oy, f);
  };

  // Rows 0-3: idle, walk down, walk up, walk side.
  const views = ['idle', 'front', 'back', 'side'];
  for (let row = 0; row < 4; row++) {
    for (let f = 0; f < 4; f++) bodyOf(f * size, row * size, f, views[row]);
  }

  if (kind === 'mutant') {
    // Row 4: telegraph. Coiled low, blades drawn back to the flanks before the strike.
    for (let f = 0; f < 3; f++) {
      const ox = f * size, oy = 4 * size, back = [1.5, 0.5, -0.5][f];
      E(ox + 10 * u, oy + 13 * u, 6 * u, 2.5 * u, ink);
      E(ox + 10 * u, oy + 13 * u, 5 * u, 2 * u, purple);
      E(ox + 9.5 * u, oy + 12.4 * u, 4 * u, 1.4 * u, flesh);
      E(ox + 6 * u, oy + 10 * u, 2.6 * u, 2 * u, flesh);
      E(ox + 5 * u, oy + 7 * u, 1.4 * u, 1.4 * u, green);
      E(ox + 8 * u, oy + 6.4 * u, 1.6 * u, 1.4 * u, green);
      E(ox + 11 * u, oy + 6.8 * u, 1.2 * u, 1.2 * u, green);
      L(ox + 5 * u, oy + 11 * u, ox + 1 * u, oy + (4 + back) * u, bone);
      L(ox + 6 * u, oy + 11 * u, ox + 2 * u, oy + (5 + back) * u, flesh);
      L(ox + 5 * u, oy + 12 * u, ox + 1 * u, oy + (19 - back) * u, bone);
      L(ox + 6 * u, oy + 12 * u, ox + 2 * u, oy + (18 - back) * u, flesh);
    }
    // Row 5: lunge. Both bone scythes scissor through an enormous X-cross.
    for (let f = 0; f < 2; f++) {
      const ox = f * size, oy = 5 * size, spread = f === 0 ? 1 : 0;
      E(ox + 9 * u, oy + 14 * u, 5 * u, 2.4 * u, ink);
      E(ox + 9 * u, oy + 14 * u, 4.2 * u, 1.8 * u, purple);
      E(ox + 8 * u, oy + 13.4 * u, 3.4 * u, 1.2 * u, flesh);
      E(ox + 7 * u, oy + 10 * u, 1.2 * u, 1.2 * u, green);
      L(ox + (1 + spread) * u, oy + 3 * u, ox + (19 - spread) * u, oy + 18 * u, bone);
      L(ox + (2 + spread) * u, oy + 4 * u, ox + (18 - spread) * u, oy + 17 * u, flesh);
      L(ox + (1 + spread) * u, oy + 18 * u, ox + (19 - spread) * u, oy + 3 * u, bone);
      L(ox + (2 + spread) * u, oy + 17 * u, ox + (18 - spread) * u, oy + 4 * u, flesh);
      if (f === 1) E(ox + 15 * u, oy + 11 * u, 2 * u, 2 * u, green);
    }
    // Row 6: recover. Crouched and panting, scythes dragging on the tiles.
    for (let f = 0; f < 2; f++) {
      const ox = f * size, oy = 6 * size, sink = f * 0.5;
      E(ox + 10 * u, oy + (15 + sink) * u, 6 * u, 2.2 * u, ink);
      E(ox + 10 * u, oy + (15 + sink) * u, 5 * u, 1.6 * u, purple);
      E(ox + 8.5 * u, oy + (14.4 + sink) * u, 3 * u, 1.2 * u, flesh);
      E(ox + 6 * u, oy + 11 * u, 1.2 * u, 1.2 * u, green);
      E(ox + 10 * u, oy + 12 * u, 1.2 * u, 1.2 * u, green);
      L(ox + 4 * u, oy + 15 * u, ox + 1 * u, oy + 19 * u, bone);
      L(ox + 16 * u, oy + 15 * u, ox + 19 * u, oy + 19 * u, bone);
      L(ox + 3 * u, oy + 19 * u, ox + 0.5 * u, oy + 17 * u, bone);
      L(ox + 17 * u, oy + 19 * u, ox + 19.5 * u, oy + 17 * u, bone);
    }
  } else {
    // Row 4: firing stance. The torso braces while the weapon arm kicks.
    for (let f = 0; f < 2; f++) {
      const ox = f * size, oy = 4 * size;
      if (kind === 'guard') {
        guardBody(ox, oy, 0, 'front');
        R(ox + (13 + f) * u, oy + 8 * u, 4 * u, 2 * u, white);
        R(ox + (16 + f) * u, oy + 9 * u, 2 * u, 1 * u, blue);
      } else {
        enforcerBody(ox, oy, 0, 'front');
        R(ox + (13 + f) * u, oy + 8 * u, 5 * u, 3 * u, charcoal);
        R(ox + (16 + f) * u, oy + 9 * u, 2 * u, 1 * u, orange);
      }
    }
    // Row 5: death drop. The body folds and settles into the floor.
    for (let f = 0; f < 3; f++) {
      const ox = f * size, oy = 5 * size, sink = f * 1.5;
      R(ox + 2 * u, oy + (13 + sink) * u, 16 * u, 3.5 * u, ink);
      R(ox + 3 * u, oy + (14 + sink) * u, 14 * u, 2 * u, f === 2 ? navy : white);
      R(ox + (6 + f) * u, oy + (14 + sink) * u, 4 * u, 2 * u, blue);
      if (f < 2) E(ox + 10 * u, oy + (12 + sink) * u, 3 * u, 2 * u, white);
    }
  }

  const headRow = kind === 'mutant' ? 7 : 6;
  const weaponRow = headRow + 1;

  // Head cell is centered on the neck pivot; the renderer supplies the glow
  // strip and the gaze offset so the eyes always find the cursor.
  let y = headRow * size;
  if (kind === 'guard') {
    E(10 * u, y + 10 * u, 5 * u, 5 * u, ink);
    E(10 * u, y + 10 * u, 4 * u, 4 * u, white);
    R(8 * u, y + 8 * u, 8 * u, 2 * u, navy);
    E(7 * u, y + 8 * u, 1.5 * u, 1.5 * u, blue);
    R(7 * u, y + 14 * u, 6 * u, 2 * u, navy);
  } else if (kind === 'enforcer') {
    R(4 * u, y + 5 * u, 12 * u, 11 * u, ink);
    R(5 * u, y + 6 * u, 10 * u, 9 * u, yellow);
    R(8 * u, y + 8 * u, 8 * u, 2 * u, charcoal);
    R(6 * u, y + 6 * u, 3 * u, 2 * u, white);
    R(5 * u, y + 13 * u, 10 * u, 2 * u, charcoal);
    s.put(6 * u, y + 12 * u, orange);
  } else {
    // Tapered predatory skull, split needle-tooth maw, three ocular pits.
    R(3 * u, y + 7 * u, 12 * u, 8 * u, ink);
    R(4 * u, y + 8 * u, 10 * u, 6 * u, flesh);
    R(5 * u, y + 8 * u, 6 * u, 2 * u, purple);
    R(12 * u, y + 8 * u, 5 * u, 4 * u, ink);
    R(13 * u, y + 9 * u, 4 * u, 2 * u, flesh);
    R(7 * u, y + 6 * u, 9 * u, 3.2 * u, ink);
    R(8 * u, y + 11 * u, 9.5 * u, 3 * u, ink);
    for (let i = 0; i < 5; i++) {
      R((9.6 + i * 1.7) * u, y + 10.2 * u, 1 * u, 1.6 * u, bone);
      R((9.6 + i * 1.7) * u, y + 13.4 * u, 1 * u, 1.6 * u, bone);
    }
  }

  // Weapon cell: pivot sits at cell x=7, y=10, blade points along +x.
  y = weaponRow * size;
  if (kind === 'guard') {
    R(3 * u, y + 8 * u, 4 * u, 4 * u, ink);
    R(3.5 * u, y + 9 * u, 3 * u, 2 * u, blue);
    R(6 * u, y + 8 * u, 10 * u, 3 * u, ink);
    R(7 * u, y + 9 * u, 8 * u, 1 * u, blue);
    R(15 * u, y + 8 * u, 3 * u, 3 * u, ink);
    R(16 * u, y + 9 * u, 2 * u, 1 * u, cyan);
    R(6 * u, y + 11 * u, 3 * u, 3 * u, white);
    s.put(9 * u, y + 10 * u, cyan);
  } else if (kind === 'enforcer') {
    R(2 * u, y + 7 * u, 6 * u, 6 * u, ink);
    R(3 * u, y + 8 * u, 5 * u, 4 * u, charcoal);
    R(4 * u, y + 9 * u, 2 * u, 2 * u, yellow);
    R(9 * u, y + 7 * u, 9 * u, 2 * u, ink);
    R(10 * u, y + 8 * u, 7 * u, 1 * u, white);
    R(9 * u, y + 11 * u, 9 * u, 2 * u, ink);
    R(10 * u, y + 12 * u, 7 * u, 1 * u, white);
    R(16 * u, y + 6 * u, 3 * u, 2 * u, ink);
    R(16 * u, y + 12 * u, 3 * u, 2 * u, ink);
    R(4 * u, y + 13 * u, 4 * u, 2 * u, yellow);
  } else {
    // Paired curved bone scythes: one shears high, one low.
    E(4 * u, y + 10 * u, 3 * u, 3 * u, purple);
    E(3.5 * u, y + 10 * u, 2 * u, 2 * u, flesh);
    L(5 * u, y + 8.6 * u, 18 * u, y + 3.6 * u, bone);
    L(6 * u, y + 8.2 * u, 18 * u, y + 4.6 * u, flesh);
    L(6 * u, y + 9.6 * u, 18 * u, y + 5.6 * u, bone);
    L(5 * u, y + 11.4 * u, 18 * u, y + 16.4 * u, bone);
    L(6 * u, y + 11.8 * u, 18 * u, y + 15.4 * u, flesh);
    L(6 * u, y + 12.4 * u, 18 * u, y + 14.4 * u, bone);
  }

  s.save(`${kind}-rig.png`);
}
makeRig('guard', 20); makeRig('enforcer', 32); makeRig('mutant', 28);

// 24x36 cells: cryogenic vat, biomonitor terminal, laser pylon, shield.
{
  const s=sheet(96,36), metal=C('#34425A'), pale=C('#8CA0BA'), glass=C('#004D25'), cyan=C('#00F5FF'), gold=C('#FFB703'), navy=C('#1B263B');
  s.rect(3,1,18,34,ink);s.rect(4,3,16,29,metal);s.rect(6,6,12,22,glass);s.rect(7,7,10,19,emerald);
  s.ellipse(12,16,3,6,navy);s.rect(7,5,10,2,cyan);s.rect(5,2,14,3,pale);s.rect(5,29,14,4,pale);
  for(const [x,y] of [[8,10],[16,12],[9,23],[15,20]])s.put(x,y,green);
  s.rect(27,8,18,25,ink);s.rect(28,9,16,21,metal);s.rect(30,11,12,11,navy);s.line(31,17,33,17,green);s.line(33,17,35,13,green);s.line(35,13,37,20,green);s.line(37,20,39,16,green);s.line(39,16,41,16,green);s.rect(31,25,2,2,cyan);s.rect(36,25,2,2,red);
  s.rect(51,10,18,16,ink);s.rect(52,11,16,14,metal);s.rect(55,13,10,10,pale);s.rect(57,15,6,6,red);s.rect(59,17,2,2,C('#FF88AA'));
  s.rect(73,4,16,28,ink);s.rect(74,5,14,26,metal);s.rect(75,6,11,24,gold);s.rect(77,8,7,20,navy);s.rect(87,7,2,22,cyan);
  s.save('lab-props.png');
}
