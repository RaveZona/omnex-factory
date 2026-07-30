import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe'
const B='D:/OMNEX_Factory/packs'
for(const pack of ['automotive','jewellery','food']){
 const IMG=`${B}/${pack}/images`
 const man=JSON.parse(readFileSync(`${B}/${pack}/manifest.json`,'utf8'))
 const files=readdirSync(IMG).filter(f=>f.endsWith('.png')).sort().slice(0,9)
 const cells=files.map(f=>{
  const b64=readFileSync(`${IMG}/${f}`).toString('base64')
  return `<div class="cell"><img src="data:image/png;base64,${b64}"><div class="wm"><span>OMNEX · PREVIEW</span></div></div>`
 }).join('')
 const html=`<!doctype html><meta charset=utf-8><style>
*{margin:0;box-sizing:border-box}body{width:1200px;height:1200px;background:#111;font-family:'Segoe UI',sans-serif}
.grid{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:6px;width:1200px;height:1200px;padding:6px}
.cell{position:relative;overflow:hidden;border-radius:4px}.cell img{width:100%;height:100%;object-fit:cover;display:block}
.wm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.wm span{color:rgba(255,255,255,.35);font-size:20px;font-weight:700;letter-spacing:3px;transform:rotate(-30deg)}
.badge{position:absolute;left:0;right:0;bottom:0;background:rgba(10,12,18,.88);color:#fff;padding:20px 28px;display:flex;justify-content:space-between;align-items:baseline}
.badge b{font-size:30px;font-weight:800;letter-spacing:-.5px}.badge .s{font-size:17px;color:#9aa4b8}</style>
<div class="grid">${cells}</div>
<div class="badge"><b>${man.name}</b><span class="s">${man.count} premium scenes · commercial licence</span></div>`
 writeFileSync(`${B}/${pack}/_grid.html`,html)
 execFileSync(CHROME,['--headless','--disable-gpu','--no-sandbox','--hide-scrollbars','--window-size=1200,1200','--force-device-scale-factor=1',`--screenshot=${B}/${pack}/preview-grid.png`,`file:///${B}/${pack}/_grid.html`],{stdio:'ignore'})
 console.log(`${pack}: preview-grid.png`)
}
