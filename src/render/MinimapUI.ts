import type { RoomManager } from "../dungeon/RoomManager";

export function drawMinimap(ctx: CanvasRenderingContext2D, dungeon: RoomManager, width: number, time: number): void {
  const x = width - 182, y = 18, scale = 2;
  ctx.save(); ctx.translate(x,y); ctx.scale(scale,scale); ctx.imageSmoothingEnabled=false;
  ctx.fillStyle="rgba(10,15,24,0.9)"; ctx.fillRect(0,0,84,64);
  ctx.strokeStyle="#34425a"; ctx.lineWidth=0.5; ctx.strokeRect(0.5,0.5,83,63);
  const rooms=dungeon.layout.rooms, cellX=14, cellY=11, ox=8, oy=5;
  const visible = (id:number): boolean => rooms[id]!.visited || rooms[id]!.neighbors.some(n=>rooms[n]!.visited);
  for (const room of rooms) for (const id of room.neighbors) {
    if (id < room.id || !visible(room.id) || !visible(id)) continue;
    const other=rooms[id]!; ctx.strokeStyle="#657c8c"; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(ox+room.gx*cellX+5,oy+room.gy*cellY+4); ctx.lineTo(ox+other.gx*cellX+5,oy+other.gy*cellY+4); ctx.stroke();
  }
  for (const room of rooms) {
    if (!visible(room.id)) continue;
    const rx=ox+room.gx*cellX,ry=oy+room.gy*cellY;
    ctx.fillStyle=room.visited?"#34425a":"#10141e"; ctx.fillRect(rx,ry,10,8);
    ctx.strokeStyle=room.id===dungeon.current && Math.sin(time*7)>-0.2?"#00e5ff":room.visited?"#738ca0":"#3a4454";
    ctx.lineWidth=1;ctx.strokeRect(rx+0.5,ry+0.5,9,7);
    ctx.fillStyle=room.visited?"#d8f5e6":"#738ca0"; ctx.font="bold 6px monospace";ctx.textAlign="center";ctx.textBaseline="middle";
    const icon=!room.visited?"?":room.kind==="elite"?"☠":room.kind==="altar"?"+":room.kind==="chest"?"▣":room.kind==="portal"?"◉":"";
    if(icon)ctx.fillText(icon,rx+5,ry+4);
  }
  ctx.restore();
}
