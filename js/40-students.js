// --- ÖĞRENCİ YÖNETİMİ & EXCEL/CSV ---
    function renderOgrenci() {
        dinleyicileriTemizle();
        document.getElementById('app').innerHTML = `
            <div class="card">
                <h2>Okul ve Öğrenci Listeleri</h2>
                <div class="btn-grid" style="grid-template-columns: 1fr 1fr; margin-bottom:20px;">
                    <button class="btn kat-btn ${secimler.kategori==='ORTAOKUL'?'btn-active':''}" onclick="katSec(this, 'ORTAOKUL', 'ogrenci')">ORTAOKUL LİSTESİ</button>
                    <button class="btn kat-btn ${secimler.kategori==='LİSE'?'btn-active':''}" onclick="katSec(this, 'LİSE', 'ogrenci')">LİSE LİSTESİ</button>
                </div>
                <div class="file-upload-wrapper">
                    <div style="font-size:14px; font-weight:bold; margin-bottom:8px; color:var(--accent);">📁 Toplu Okul/Öğrenci Yükleme (.xlsx / .csv)</div>
                    <div style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">Sütunlar: <b>Okul Adı</b> ve <b>Öğrenci Ad Soyad</b>. Aktif Kategori: <b>${secimler.kategori}</b></div>
                    <input type="file" id="excelDosya" accept=".xlsx, .xls, .csv" style="padding:5px; background:transparent; border:none;">
                    <button class="btn" style="background:var(--success); border:none; margin-top:10px; padding:10px;" onclick="excelTopluYukle()">Dosyayı İşle ve Kaydet</button>
                </div>
                <div style="text-align:center; font-weight:bold; color:var(--text-muted); margin:15px 0;">Veya Tek Tek Ekle:</div>
                <input type="text" id="okulAd" placeholder="Okul Adı">
                <input type="text" id="ogrAd" placeholder="Öğrenci Ad Soyad">
                <button class="btn" style="background:var(--primary); border:none;" onclick="ogrenciKaydet()">Öğrenci Kaydet</button>
                <div id="okulListesi" style="margin-top:25px;"></div>
                <button class="btn" style="background:#1e40af;border:1px solid #3b82f6;" onclick="renderYoneticiOgrenciEsleme()">🔗 Öğrenci Listesi Eşleştirmeleri (Yönetici)</button>
                <button class="btn" style="background:#475569" onclick="anaMenu()">← Ana Menü</button>
            </div>`;
        okulListesiniYenile();
    }

    function turkceMetinDuzelt(deger) {
        let s=String(deger??'').replace(/^\uFEFF/,'').replace(/\u00A0/g,' ').normalize('NFC').trim();
        const bozukKarakterler={'Ã§':'ç','Ã‡':'Ç','ÄŸ':'ğ','Äž':'Ğ','Ä±':'ı','Ä°':'İ','Ã¶':'ö','Ã–':'Ö','ÅŸ':'ş','Åž':'Ş','Ã¼':'ü','Ãœ':'Ü','â€™':'’','â€œ':'“','â€':'”','â€“':'–','â€”':'—','Â':'','ï»¿':''};
        for(const [bozuk,dogru] of Object.entries(bozukKarakterler)) s=s.split(bozuk).join(dogru);
        return s.normalize('NFC').trim();
    }

    function csvBufferCoz(buffer) {
        const bytes=new Uint8Array(buffer);
        if(bytes.length>=3&&bytes[0]===0xEF&&bytes[1]===0xBB&&bytes[2]===0xBF)return{text:new TextDecoder('utf-8').decode(bytes),encoding:'UTF-8 BOM'};
        if(bytes.length>=2&&bytes[0]===0xFF&&bytes[1]===0xFE)return{text:new TextDecoder('utf-16le').decode(bytes),encoding:'UTF-16 LE'};
        if(bytes.length>=2&&bytes[0]===0xFE&&bytes[1]===0xFF)return{text:new TextDecoder('utf-16be').decode(bytes),encoding:'UTF-16 BE'};
        try{return{text:new TextDecoder('utf-8',{fatal:true}).decode(bytes),encoding:'UTF-8'};}catch(_){try{return{text:new TextDecoder('windows-1254').decode(bytes),encoding:'Windows-1254'};}catch(_){return{text:new TextDecoder('iso-8859-9').decode(bytes),encoding:'ISO-8859-9'};}}
    }

    function firebaseKeyTemizle(isim) { return turkceMetinDuzelt(isim).replace(/[\.\#\$\/\[\]]/g,'').trim(); }


    async function excelTopluYukle() {
        const fileInput=document.getElementById('excelDosya');
        if(!fileInput?.files.length)return alert('Önce Excel veya CSV dosyası seçin.');
        const file=fileInput.files[0],kategori=secimler.kategori;
        try{
            const buffer=await file.arrayBuffer(),ext=(file.name||'').toLocaleLowerCase('tr-TR');
            let workbook,encoding='';
            if(ext.endsWith('.csv')){const parsed=csvBufferCoz(buffer);encoding=parsed.encoding;workbook=XLSX.read(parsed.text,{type:'string',raw:false});}
            else workbook=XLSX.read(buffer,{type:'array',cellText:true,cellDates:true});
            if(!workbook.SheetNames?.length)throw new Error('Çalışma sayfası bulunamadı.');
            const rows=XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1,raw:false,defval:''});
            const prepared=[],seen=new Set();let inFileDuplicates=0,invalid=0;
            const norm=x=>turkceMetinDuzelt(x).replace(/\s+/g,' ').toLocaleLowerCase('tr-TR');
            for(let i=1;i<rows.length;i++){
                const row=rows[i];if(!row?.length)continue;
                const raw=turkceMetinDuzelt(row[0]),student=turkceMetinDuzelt(row[1]),school=firebaseKeyTemizle(raw);
                if(!school||!student||norm(raw)==='okul adı'){if(raw||student)invalid++;continue;}
                const key=norm(school)+'|'+norm(student);
                if(seen.has(key)){inFileDuplicates++;continue;}
                seen.add(key);prepared.push({school,student});
            }
            if(!prepared.length)return alert('Eklenecek geçerli yeni öğrenci bulunamadı.');
            let inserted=0,already=0;
            const dbRef=db.ref('okullar/'+kategori);
            // Bütün dosya tek transaction ile kaydedilir: eşzamanlı iki aktarım mükerrer oluşturamaz.
            const res=await dbRef.transaction(cur=>{
                const data=cur||{};
                let insertedLocal=0,alreadyLocal=0;
                const bySchool={};
                for(const school of Object.keys(data))bySchool[norm(school)]=school;
                for(const row of prepared){
                    const existingKey=bySchool[norm(row.school)]||row.school;
                    bySchool[norm(row.school)]=existingKey;
                    data[existingKey]=data[existingKey]||{};
                    const found=Object.values(data[existingKey]).some(x=>typeof x==='string'&&norm(x)===norm(row.student));
                    if(found){alreadyLocal++;continue;}
                    const childKey=db.ref().push().key;
                    data[existingKey][childKey]=row.student;
                    insertedLocal++;
                }
                inserted=insertedLocal;already=alreadyLocal;
                return insertedLocal?data:undefined;
            },undefined,false);
            if(!res.committed&&inserted)throw new Error('Okul listesi aynı anda güncellendi. Tekrar deneyin.');
            if(!res.committed)inserted=0;
            alert(`Excel/CSV tamamlandı.\nYeni öğrenci: ${inserted}\nÖnceden kayıtlı: ${already}\nDosyada tekrar eden: ${inFileDuplicates}\nEksik/geçersiz satır: ${invalid}${encoding?'\nKodlama: '+encoding:''}\n\nVar olan öğrenciler ve sıraları korunmuştur.`);
            fileInput.value='';okulListesiniYenile();
        }catch(err){console.error('Excel öğrenci aktarımı:',err);alert('Aktarım yapılamadı: '+(err?.message||err));}
    }

    async function okulListesiniYenile() {
        const kategori=secimler.kategori;
        const l=document.getElementById('okulListesi');if(!l)return;
        l.textContent='Firebase öğrenci kayıtları kontrol ediliyor…';
        try{
            const s=await db.ref('okullar/'+kategori).once('value');
            if(!document.getElementById('okulListesi') || secimler.kategori!==kategori)return;
            l.innerHTML='';let okulSayisi=0,ogrenciSayisi=0;
            s.forEach(o=>{
                okulSayisi++;ogrenciSayisi+=o.numChildren?.()??Object.keys(o.val()||{}).length;
                const wrap=document.createElement('div');wrap.style.marginBottom='10px';
                const btn=document.createElement('button');btn.className='btn';btn.style='background:#1e293b;text-align:left;border-left:4px solid var(--primary);margin:0;';btn.textContent='🏫 '+o.key;
                const inner=document.createElement('div');inner.id='list-'+hash32(o.key);inner.style='display:none;padding:12px;background:#111827;border:1px solid var(--border-color);border-radius:0 0 10px 10px;';
                btn.onclick=()=>togg(o.key,inner);wrap.append(btn,inner);l.appendChild(wrap);
            });
            const durum=document.createElement('div');durum.className='puanlama-bilgi';
            durum.textContent=okulSayisi?`${kategori}: Firebase’de ${okulSayisi} okul, ${ogrenciSayisi} öğrenci kaydı bulundu.`:
                `${kategori} kategorisinde Firebase üzerinde şu anda okul/öğrenci kaydı bulunamadı. Diğer kategoriyi de kontrol edin; önceki yedeği incelemeden yeniden toplu yükleme yapmayın.`;
            l.prepend(durum);
        }catch(err){l.innerHTML='<div class="puanlama-bilgi hata">Firebase öğrenci listesi okunamadı: '+htmlEscape(err?.message||err)+'. Bu hata kayıtların silindiği anlamına gelmez.</div>';}
    }

    function ogrenciKaydet() { const school=turkceMetinDuzelt(document.getElementById('okulAd').value),student=turkceMetinDuzelt(document.getElementById('ogrAd').value);if(!school||!student)return alert('Lütfen alanları boş bırakmayın!');const temizOkul=firebaseKeyTemizle(school);db.ref(`okullar/${secimler.kategori}/${temizOkul}`).push(student).then(()=>{alert('Öğrenci başarıyla veritabanına kaydedildi!');document.getElementById('ogrAd').value='';okulListesiniYenile();}).catch(err=>alert('Öğrenci kaydedilemedi: '+(err?.message||err))); }
    function togg(o,d) { const durum=d.style.display;document.querySelectorAll('[id^="list-"]').forEach(el=>el.style.display='none');if(durum==='none'){d.style.display='block';ogrenciListesiniDoldur(o,d);} }
    function ogrenciListesiniDoldur(o,divElement){db.ref('okullar/'+secimler.kategori+'/'+o).once('value',s=>{
        divElement.innerHTML='';
        const schoolBtn=document.createElement('button');schoolBtn.className='btn';
        schoolBtn.style='background:#1d4ed8;border:none;padding:9px;font-size:13px;margin:0 0 10px;';
        schoolBtn.textContent='✏️ Okul Adını Düzenle';schoolBtn.onclick=()=>okulAdiniDegistir(o);
        divElement.appendChild(schoolBtn);
        s.forEach(ogr=>{
            const row=document.createElement('div');row.style='padding:6px;display:flex;gap:8px;justify-content:space-between;align-items:center;border-bottom:1px solid #1f2937;';
            const span=document.createElement('span');span.style='flex:1;min-width:0;overflow-wrap:anywhere;';span.textContent='👤 '+ogr.val();
            const edit=document.createElement('button');edit.style='background:#2563eb;color:white;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:bold;';
            edit.textContent='Düzenle';edit.onclick=()=>ogrenciAdiniDegistir(o,ogr.key,divElement);
            const del=document.createElement('button');del.style='background:#ef4444;color:white;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:bold;';
            del.textContent='Sil';del.onclick=()=>ogrenciSil(o,ogr.key,divElement);
            row.append(span,edit,del);divElement.appendChild(row);
        });
        const del=document.createElement('button');del.className='btn';del.style='background:#b91c1c;border:none;margin-top:12px;font-size:13px;padding:8px;';
        del.textContent='❌ Okulu ve Tüm Öğrencileri Sil';del.onclick=()=>okulKompleSil(o);divElement.appendChild(del);
    }).catch(err=>{divElement.textContent='Öğrenciler getirilemedi: '+(err?.message||err);});}

    // Bu işlemler yalnızca öğrenci kayıtlarının adını düzeltir; fikstürü/maç kimliğini değiştirmez.
    async function okulAdiniDegistir(eskiAd){
        if(!adminYetkiliMi())return alert('Yalnızca Yönetici Modülünden okul adı düzenlenebilir.');
        if(!firebaseBagli||!navigator.onLine)return alert('Okul adı değiştirmek için Firebase bağlantısı gerekli.');
        const kat=secimler.kategori;
        const girilen=prompt('Okulun yeni adını giriniz:',eskiAd);
        if(girilen===null)return;
        const yeniAd=turkceMetinDuzelt(girilen),key=firebaseKeyTemizle(yeniAd);
        if(!key||yeniAd!==key)return alert('Okul adı boş olamaz ve Firebase anahtarında geçersiz karakter içeremez (., #, $, /, [, ]).');
        if(yeniAd===eskiAd)return;
        if(!confirm(`Okul listesi adı değiştirilecek:\n${eskiAd} → ${yeniAd}\n\nÖğrenciler ve sıraları korunur. Resmî fikstür, maç sonuçları ve eski jüri puanları değiştirilmez. Devam edilsin mi?`))return;
        try{
            let hata='';
            const result=await db.ref('okullar/'+kat).transaction(cur=>{
                if(!cur||!Object.prototype.hasOwnProperty.call(cur,eskiAd)){hata='Eski okul kaydı bulunamadı.';return;}
                const ayni=Object.keys(cur).find(x=>x!==eskiAd&&skorEslesmeAnahtari(x)===skorEslesmeAnahtari(yeniAd));
                if(ayni){hata='Bu isimde bir okul zaten kayıtlı: '+ayni;return;}
                cur[yeniAd]=cur[eskiAd];delete cur[eskiAd];return cur;
            },undefined,false);
            if(!result.committed)return alert('Okul adı değiştirilemedi. '+(hata||'Liste başka cihazda güncellenmiş olabilir.'));
            // Yalnızca mevcut maçların öğrenci listesi KAYNAK bağlantılarını yeniden göster.
            // Hükümet/muhalefet tarafları, fikstür maçları ve kimlikleri aynen korunur.
            let uyari='';
            try{
                const macSnap=await db.ref('maclar/'+kat).once('value');
                const updates={};
                macSnap.forEach(s=>{
                    const m=s.val();if(!m||!m.hukOkul||!m.muhOkul)return;
                    for(const [taraf,okul] of [['huk',m.hukOkul],['muh',m.muhOkul]]){
                        const kaynak=m.ogrenciKaynaklari?.[taraf];
                        if(kaynak===eskiAd||(!kaynak&&skorEslesmeAnahtari(okul)===skorEslesmeAnahtari(eskiAd)))
                            updates[`${s.key}/ogrenciKaynaklari/${taraf}`]=yeniAd;
                    }
                });
                if(Object.keys(updates).length)await db.ref('maclar/'+kat).update(updates);
            }catch(err){uyari=' Mevcut bazı maçların öğrenci kaynağı bağlantısı güncellenemedi; Yönetici → Öğrenci Listesi Eşleştirmeleri alanından kontrol edin. Ayrıntı: '+(err?.message||err);}
            alert('Okulun kayıtlı adı değiştirildi. Fikstür ve eski puanlar korunmuştur.'+uyari);
            okulListesiniYenile();
        }catch(err){alert('Okul adı değiştirilemedi: '+(err?.message||err));}
    }

    async function ogrenciAdiniDegistir(okulAd,ogrKey,divElement){
        if(!adminYetkiliMi())return alert('Yalnızca Yönetici Modülünden öğrenci adı düzenlenebilir.');
        if(!firebaseBagli||!navigator.onLine)return alert('Öğrenci adı değiştirmek için Firebase bağlantısı gerekli.');
        const kat=secimler.kategori;
        try{
            const ogrRef=db.ref(`okullar/${kat}/${okulAd}/${ogrKey}`);
            const onceki=(await ogrRef.once('value')).val();
            if(typeof onceki!=='string')return alert('Öğrenci kaydı bulunamadı; listeyi yenileyin.');
            const girilen=prompt('Öğrencinin yeni ad ve soyadını giriniz:',onceki);
            if(girilen===null)return;
            const yeniAd=turkceMetinDuzelt(girilen);
            if(!yeniAd)return alert('Öğrenci adı boş olamaz.');
            if(yeniAd===onceki)return;
            const norm=skorEslesmeAnahtari;
            const [oSnap,pSnap,mSnap]=await Promise.all([
                db.ref(`okullar/${kat}/${okulAd}`).once('value'),
                db.ref('puanlar/'+kat).once('value'),
                db.ref('maclar/'+kat).once('value')
            ]);
            const roster=oSnap.val()||{};
            if(Object.keys(roster).some(k=>k!==ogrKey&&norm(roster[k])===norm(yeniAd)))return alert('Bu okulda aynı isimde başka bir öğrenci zaten var.');
            const maclar=mSnap.val()||{};
            let scored=false;
            pSnap.forEach(c=>{
                const v=c.val(),s=v?.secim||{};
                if(norm((s.ogr||'').split(' (')[0])!==norm(onceki))return;
                const m=maclar[kayitMacId(v)]||{};
                const taraf=s.taraf==='HÜKÜMET'?'huk':s.taraf==='MUHALEFET'?'muh':'';
                const kaynak=m.ogrenciKaynaklari?.[taraf]||(taraf==='huk'?m.hukOkul:m.muhOkul)||s.okul;
                if(norm(kaynak)===norm(okulAd)||norm(s.okul)===norm(okulAd))scored=true;
            });
            if(scored)return alert('Bu öğrenciye ait jüri puanı bulundu. Tamamlanmış puanların kimliğini ve 3/3 jüri eşleşmesini bozmamak için ad değişikliği durduruldu. Puanlanmış kayıtlar için ayrıca kontrollü veri düzeltmesi gerekir.');
            let hata='';
            const result=await db.ref(`okullar/${kat}/${okulAd}`).transaction(cur=>{
                if(!cur||cur[ogrKey]!==onceki){hata='Öğrenci başka cihazda güncellendi.';return;}
                if(Object.keys(cur).some(k=>k!==ogrKey&&norm(cur[k])===norm(yeniAd))){hata='Aynı isimde öğrenci mevcut.';return;}
                cur[ogrKey]=yeniAd;return cur;
            },undefined,false);
            if(!result.committed)return alert('Ad değiştirilemedi. '+(hata||'Lütfen yeniden deneyin.'));
            ogrenciListesiniDoldur(okulAd,divElement);
            alert('Öğrenci adı güncellendi. Öğrenci sırası, fikstür ve jüri kayıtları korunmuştur.');
        }catch(err){alert('Öğrenci adı değiştirilemedi: '+(err?.message||err));}
    }

    // Yalnızca yönetici alanında, resmî maçla öğrenci listesi kaynağını ilişkilendirir.
    let yonEslemeMaclari=new Map();
    let yonEslemeOkullari={};
    async function renderYoneticiOgrenciEsleme(){
        if(!adminYetkiliMi())return alert('Öğrenci listesi eşleştirmeleri için yönetici girişi gerekli.');
        dinleyicileriTemizle();
        const kat=secimler.kategori;
        document.getElementById('app').innerHTML=`<div class="card" style="max-width:940px">
            <h2>Yönetici · Öğrenci Listesi Eşleştirmeleri</h2>
            <p class="sure-hint">Bu işlem <b>maç eşleşmesini değiştirmez</b>. Yalnızca fikstürdeki okul adını kayıtlı öğrenci listesine bağlar. Doğru eşleşmiş maçlarda ayrıca onay istenmez.</p>
            <div id="yonEslemeDurum" class="puanlama-bilgi">Sabit fikstür ve okul kayıtları kontrol ediliyor…</div>
            <label class="puanlama-etiket">Resmî karşılaşma (${htmlEscape(kat)})</label>
            <select id="yonEslemeMac" onchange="yoneticiEslemePanelGuncelle()"></select>
            <div id="yonEslemePanel"></div>
            <button class="btn" style="background:#475569" onclick="renderOgrenci()">← Okullar ve Öğrenciler</button>
        </div>`;
        try{
            const [fixture,rosterSnap,macSnap]=await Promise.all([
                puanlamaFiksturMaclariniOku(),
                db.ref('okullar/'+kat).once('value'),
                db.ref('maclar/'+kat).once('value')
            ]);
            if(!document.getElementById('yonEslemeMac')||secimler.kategori!==kat)return;
            yonEslemeOkullari=puanlamaRosteriGetir(rosterSnap);
            const mevcut=macSnap.val()||{};
            yonEslemeMaclari=new Map();
            const fixtures=fixture.filter(m=>m.cat===(kat==='LİSE'?'lise':'ortaokul')&&puanlamaGecerliFiksturMaci(m));
            for(const m of fixtures){
                const id=macKimligiOlustur(kat,m.team1,m.team2);
                yonEslemeMaclari.set(id,puanlamaFiksturMacKaydi(m,mevcut[id]||{}));
            }
            const select=document.getElementById('yonEslemeMac');
            select.innerHTML='<option value="">Maç seçiniz</option>'+[...yonEslemeMaclari.values()]
                .map(m=>`<option value="${htmlEscape(m.id)}">#${m.fiksturNo} · ${htmlEscape(m.hukOkul)} — ${htmlEscape(m.muhOkul)}</option>`).join('');
            document.getElementById('yonEslemeDurum').textContent=`${yonEslemeMaclari.size} resmî maç, ${Object.keys(yonEslemeOkullari).length} kayıtlı okul. Eşleştirilecek maçı seçin.`;
        }catch(err){const d=document.getElementById('yonEslemeDurum');if(d){d.className='puanlama-bilgi hata';d.textContent='Veri okunamadı: '+(err?.message||err);}}
    }

    function yoneticiEslemePanelGuncelle(){
        const panel=document.getElementById('yonEslemePanel');if(!panel)return;
        const m=yonEslemeMaclari.get(document.getElementById('yonEslemeMac')?.value);
        if(!m){panel.innerHTML='';return;}
        const keys=Object.keys(yonEslemeOkullari).sort((a,b)=>a.localeCompare(b,'tr'));
        const find=ad=>keys.find(k=>skorEslesmeAnahtari(k)===skorEslesmeAnahtari(ad))||'';
        const kaynaklar={
            huk:yonEslemeOkullari[m.ogrenciKaynaklari?.huk]?.length?m.ogrenciKaynaklari.huk:find(m.hukOkul),
            muh:yonEslemeOkullari[m.ogrenciKaynaklari?.muh]?.length?m.ogrenciKaynaklari.muh:find(m.muhOkul)
        };
        const hazır=['huk','muh'].every(t=>kaynaklar[t]&&yonEslemeOkullari[kaynaklar[t]]?.length);
        if(hazır){
            panel.innerHTML=`<div class="puanlama-bilgi">✅ Bu maçın iki öğrenci listesi bağlı. <b>${htmlEscape(m.hukOkul)}</b>: ${htmlEscape(kaynaklar.huk)} (${yonEslemeOkullari[kaynaklar.huk].length}) · <b>${htmlEscape(m.muhOkul)}</b>: ${htmlEscape(kaynaklar.muh)} (${yonEslemeOkullari[kaynaklar.muh].length}). Değişiklik gerekmiyor.</div>
                <details><summary class="sure-hint" style="cursor:pointer;color:#93c5fd">Yönetici olarak bağlı öğrenci listesini değiştirmek</summary><div id="yonEslemeForm"></div></details>`;
            const details=panel.querySelector('details');details.addEventListener('toggle',()=>{if(details.open)yoneticiEslemeFormunuDoldur(m,kaynaklar,keys);});
            return;
        }
        panel.innerHTML='<div class="puanlama-bilgi hata">Fikstürdeki okullardan en az birinin öğrenci listesi bulunamadı. Yalnızca kayıtlı öğrenci listesi kaynağını seçin; maç tarafları değişmeyecek.</div><div id="yonEslemeForm"></div>';
        yoneticiEslemeFormunuDoldur(m,kaynaklar,keys);
    }

    function yoneticiEslemeFormunuDoldur(m,kaynaklar,keys){
        const form=document.getElementById('yonEslemeForm');if(!form)return;
        const select=(taraf,label)=>`<label class="puanlama-etiket">${label}: ${htmlEscape(taraf==='huk'?m.hukOkul:m.muhOkul)}</label>
            <select id="yonEsleme_${taraf}"><option value="">Öğrenci listesi seçiniz</option>
            ${keys.map(n=>`<option value="${htmlEscape(n)}" ${kaynaklar[taraf]===n?'selected':''}>${htmlEscape(n)} (${yonEslemeOkullari[n].length} öğrenci)</option>`).join('')}</select>`;
        form.innerHTML=select('huk','Hükümet')+select('muh','Muhalefet')+
            '<button class="btn" style="background:#1d4ed8" onclick="yoneticiOgrenciEslemeKaydet()">🔒 Öğrenci Listesi Bağlantılarını Kaydet</button>';
    }

    async function yoneticiOgrenciEslemeKaydet(){
        if(!adminYetkiliMi()||!firebaseBagli||!navigator.onLine)return alert('Çevrimiçi yönetici yetkisi gerekli.');
        const kat=secimler.kategori,m=yonEslemeMaclari.get(document.getElementById('yonEslemeMac')?.value);
        if(!m)return alert('Resmî fikstürden maç seçiniz.');
        const huk=document.getElementById('yonEsleme_huk')?.value||'',muh=document.getElementById('yonEsleme_muh')?.value||'';
        if(!huk||!muh||!yonEslemeOkullari[huk]?.length||!yonEslemeOkullari[muh]?.length)return alert('Her iki taraf için öğrencisi bulunan okul seçiniz.');
        if(huk===muh)return alert('İki taraf aynı öğrenci listesine bağlanamaz.');
        const current=m.ogrenciKaynaklari||{};
        if(current.huk===huk&&current.muh===muh)return alert('Öğrenci listesi zaten bağlı; değişiklik yapılmadı.');
        try{
            const scores=await db.ref('puanlar/'+kat).once('value');
            const puandan=surePuandanOgrenciListesi(scores,m.id);
            const hasScore=puandan.huk.length>0||puandan.muh.length>0;
            if(hasScore){
                // Maç oynanmışsa mevcut ve hâlâ geçerli bir kaynak bağlantısını değiştirme.
                const kaynakGecerli=taraf=>current[taraf]&&yonEslemeOkullari[current[taraf]]?.length;
                if((kaynakGecerli('huk')&&current.huk!==huk)||(kaynakGecerli('muh')&&current.muh!==muh))
                    return alert('Bu maçta jüri puanı varken halen geçerli bir öğrenci listesi bağlantısı değiştirilemez.');
                for(const [taraf,kaynak] of [['huk',huk],['muh',muh]]){
                    const secilen=new Set((yonEslemeOkullari[kaynak]||[]).map(skorEslesmeAnahtari));
                    const eksik=puandan[taraf].filter(ad=>!secilen.has(skorEslesmeAnahtari(ad)));
                    if(eksik.length)return alert('Bu listede daha önce puanlanan öğrenciler yok: '+eksik.join(', ')+'. Doğru okul listesini seçin.');
                }
                if(!confirm('Bu maçta jüri puanları var. Yalnızca EKSİK/KOPUK öğrenci kaynağı bağlantısı onarılacak; eski puanlar, maç sonucu ve fikstür değiştirilmeyecek. Seçilen öğrenci listelerinin doğru olduğundan emin misiniz?'))return;
            }
            const res=await db.ref(`maclar/${kat}/${m.id}`).transaction(cur=>{
                if(['kapali','iptal'].includes(cur?.durum))return;
                if(cur?.hukOkul&&(cur.hukOkul!==m.hukOkul||cur.muhOkul!==m.muhOkul))return;
                if((cur?.ogrenciKaynaklari?.huk||'')!==(current.huk||'')||(cur?.ogrenciKaynaklari?.muh||'')!==(current.muh||''))return;
                return {...cur,id:m.id,kategori:kat,hukOkul:m.hukOkul,muhOkul:m.muhOkul,
                    etiket:m.etiket,durum:cur?.durum||'acik',fiksturNo:m.fiksturNo||null,
                    ogrenciKaynaklari:{huk,muh},createdAt:cur?.createdAt||Date.now(),updatedAt:Date.now()};
            },undefined,false);
            if(!res.committed)return alert('Maç kapalı veya eşleştirme başka cihazda değişti; tekrar kontrol edin.');
            m.ogrenciKaynaklari={huk,muh};yoneticiEslemePanelGuncelle();
            alert('Yalnızca öğrenci listesi bağlantısı kaydedildi. Resmî fikstür ve maç eşleşmesi değişmedi.');
        }catch(err){alert('Öğrenci listesi bağlantısı kaydedilemedi: '+(err?.message||err));}
    }    function ogrenciSil(okulAd,ogrKey,divElement){if(confirm('Bu öğrenciyi silmek istediğinize emin misiniz?'))db.ref(`okullar/${secimler.kategori}/${okulAd}/${ogrKey}`).remove().then(()=>ogrenciListesiniDoldur(okulAd,divElement));}
    function okulKompleSil(okulAd){if(confirm(`${okulAd} okulunu ve tüm öğrencilerini listeden tamamen silmek istediğinize emin misiniz?`))db.ref(`okullar/${secimler.kategori}/${okulAd}`).remove().then(()=>{alert('Okul tamamen temizlendi.');okulListesiniYenile();});}

    