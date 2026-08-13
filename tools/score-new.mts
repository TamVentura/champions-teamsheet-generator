import { loadImage, createCanvas } from '@napi-rs/canvas';
import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
import { CARDS, within, toPixels, statsFields, Rect } from '../src/ocr/layout.js';
import { RegionData } from '../src/ocr/pixels.js';
import { readNumber } from '../src/ocr/digits.js';
const root = join(dirname(fileURLToPath(import.meta.url)),'..');
const GT:any = {
 obler:[[2,0,0,32,0,32],[32,0,20,0,10,4],[32,0,1,20,13,0],[32,0,0,32,2,0],[5,0,1,30,1,29],[0,32,1,0,1,32]],
 matteo:[[2,0,0,32,0,32],[0,0,1,32,1,32],[2,0,0,32,0,32],[25,0,10,0,24,7],[24,18,2,0,8,14],[0,0,2,32,0,32]],
};
function rd(img:any,frac:Rect):RegionData{const px=toPixels(frac,img.width,img.height);const c=createCanvas(px.w,px.h);const cx=c.getContext('2d');cx.drawImage(img,px.x,px.y,px.w,px.h,0,0,px.w,px.h);return {data:cx.getImageData(0,0,px.w,px.h).data as any,width:px.w,height:px.h};}
for (const tk of ['obler','matteo']){
  const img=await loadImage(join(root,`sample/${tk}-stats.jpg`));
  let ok=0,tot=0;const fails:string[]=[];
  for(let slot=0;slot<6;slot++)for(let s=0;s<6;s++){tot++;const t=readNumber(rd(img,within(CARDS[slot],statsFields.evValue[s])));const v=t.text?Number(t.text):0;if(v===GT[tk][slot][s])ok++;else fails.push(`s${slot}.${s}:${v}!=${GT[tk][slot][s]}`);}
  console.log(`${tk}: ${ok}/${tot}  ${fails.join(' ')}`);
}
