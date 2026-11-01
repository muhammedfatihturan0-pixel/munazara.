// --- RAPORLAMA ---
    function sifreliRaporKontrol() {
        if (!adminYetkiliMi() && !adminSifreDogrula('Sonuçlara erişmek için yetkili şifresini giriniz:')) return;
        showReport();
    }

    async function showReport() {
        if (!adminYetkiliMi()) return alert('Sonuç raporu yalnızca yönetici modülünden açılabilir.');
        dinleyicileriTemizle();
        document.getElementById('app').innerHTML = `
            <div class="card report-outer-card" style="max-width:1100px;">
                <h2>Münazara Sonuç Merkezi (${secimler.kategori})</h2>
                <div class="no-print" style="display:flex;gap:8px;margin-bottom:12px;">
                    <button class="btn kat-btn ${secimler.kategori==='ORTAOKUL'?'btn-active':''}" style="margin:0;" onclick="katSec(this,'ORTAOKUL','rapor')">ORTAOKUL</button>
                    <button class="btn kat-btn ${secimler.kategori==='LİSE'?'btn-active':''}" style="margin:0;" onclick="katSec(this,'LİSE','rapor')">LİSE</button>
                </div>
                <div id="adminMetrics" class="admin-summary-grid">
                    <div class="admin-metric"><span>Tekil Puan Kaydı</span><strong>—</strong></div>
                    <div class="admin-metric"><span>Puanlanan Öğrenci/Maç</span><strong>—</strong></div>
                    <div class="admin-metric"><span>3/3 Jüri Tamam</span><strong>—</strong></div>
                    <div class="admin-metric"><span>Jürisi Eksik</span><strong>—</strong></div>
                </div>
                <div class="report-summary-grid">
                    <div><h4 style="margin-bottom:8px; color:var(--text-muted);">🏆 En İyi Konuşmacılar (MVP)</h4><div id="mvp-podium" class="mvp-box">Hesaplanıyor...</div></div>
                    <div><h4 style="margin-bottom:8px; color:var(--text-muted);">🏫 Okulların Toplam Puanları</h4><div id="school-leaderboard" class="school-total-box">Hesaplanıyor...</div></div>
                </div>
                <div id="raporJuriKontrolKart" class="kriter-card" style="margin-bottom:18px;"><h3 style="margin-top:0; color:var(--text-main);">Jüri Tamamlama Kontrolü</h3><div id="juryCoverage" style="overflow-x:auto;">Hesaplanıyor...</div></div>
                <div id="taslakPuanAnalizi" class="kriter-card no-print" style="margin-bottom:18px;"><h3 style="margin-top:0;color:var(--text-main);">🧮 Eksik Taslak Puan Analizi</h3><div>Yükleniyor...</div></div>
                <div class="no-print" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:15px;">
                    <button class="btn" style="background:var(--success);border:none;margin:0;" onclick="raporuExcelIndir()">Excel İndir (.xlsx)</button>
                    <button class="btn" style="background:var(--primary);border:none;margin:0;" onclick="raporTakimYazdir()">Seçili Gün · Tutanak / PDF</button>
                    <button class="btn" style="background:#475569;margin:0;" onclick="renderYoneticiMenu()">Kapat</button>
                </div>
                <p class="report-print-note no-print">Tutanak, seçilen tarihteki karşılaşmaları ve öğrenci puan ayrıntılarını içerir. PDF çıktısı yalnızca seçili gün için hazırlanır. Excel dışa aktarımında ise yalnızca henüz kesinleşmemiş maçlar yer alır; bitmiş maçlar ve bunlara ait puan, süre, jüri ve taslak kayıtları hiçbir sayfaya eklenmez. Jüri isimleri önce kaydedilmiş puanlardan, bulunmuyorsa Firebase fikstür görevlendirmelerinden alınır.</p>
                <div class="no-print" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:20px;"><label id="gunFiltreLabel" for="gunFiltre" style="font-size:13px;font-weight:700;white-space:nowrap;">Tutanak günü:</label><select id="gunFiltre" style="margin:0;max-width:500px;flex:1;" onchange="tutanakTablosuDoldur()"><option value="">Günler yükleniyor…</option></select></div>
                <div id="rapor-tablosu" style="overflow-x:auto;">Veriler derleniyor...</div>
                <section id="raporKompaktYazdir" class="print-only" aria-label="Kompakt puan tutanağı"></section>

            </div>`;
        try {
            const kat=secimler.kategori;
            const [s, mSnap, fSnap, taslakSnap] = await Promise.all([
                db.ref('puanlar/' + kat).once('value'),
                db.ref('maclar/' + kat).once('value'),
                db.ref('fikstur/tekSalon_2026_2027').once('value').catch(err=>{console.warn('Rapor fikstür/isim yedeği okunamadı:',err);return null;}),
                db.ref('puanTaslaklari/' + kat).once('value').catch(err=>{console.warn('Taslak puanlar okunamadı:',err);return null;})
            ]);
            if(!document.getElementById('gunFiltre') || secimler.kategori!==kat)return;
            const kayitlar = snapshotKayitlariniTekillestir(s);
            const maclarMap = {};
            mSnap.forEach(c=>{maclarMap[c.key]=c.val();});
            const resmiFikstur=fSnap?.val()||{};
            // Fikstür kapsamı: mevcut maçları kaybetmeden sahadaki tüm gerçek eşleşmeleri göster.
            try{
                const macListesi=await puanlamaFiksturMaclariniOku();
                if(!document.getElementById('gunFiltre') || secimler.kategori!==kat)return;
                for(const f of macListesi){
                    if(f.cat!==(kat==='LİSE'?'lise':'ortaokul') || !puanlamaGecerliFiksturMaci(f))continue;
                    const id=macKimligiOlustur(kat,f.team1,f.team2);
                    const temel=puanlamaFiksturMacKaydi(f,maclarMap[id]||{});
                    maclarMap[id]={...temel,...(maclarMap[id]||{}),fiksturNo:temel.fiksturNo,fiksturTarih:temel.fiksturTarih};
                }
            }catch(err){console.warn('Sabit fikstür maçları listeye eklenemedi (mevcut kayıtlar korunur):',err);}
            raporVerisiniIsle(kayitlar, maclarMap, resmiFikstur, taslakSnap?.val()||{});
        } catch (err) {
            console.error('Rapor verisi okunamadı:', err);
            alert('Sonuçlar okunamadı: ' + (err?.message || err));
        }
    }

    function raporVerisiniIsle(kayitlar, maclarMap, resmiFikstur={}, taslaklar={}) {
        const mSet = new Map();
        const ogrenciPuanlari = {};
        const okulPuanlari = {};
        const juriGruplari = {};
        kayitlar.forEach(v => {
            const mid = kayitMacId(v), ml = kayitMacEtiketi(v);
            mSet.set(mid, ml);
            const toplamPuan = puanToplami(v);
            const secim = v.secim || {};
            const ogrKisa = (secim.ogr || '').split(' (')[0];
            if(secim.ogr) {
                const temizIsim = ogrKisa + ' (' + (secim.okul || '-') + ')';
                if(!ogrenciPuanlari[temizIsim]) ogrenciPuanlari[temizIsim] = { skor:0, sayac:0 };
                ogrenciPuanlari[temizIsim].skor += toplamPuan;
                ogrenciPuanlari[temizIsim].sayac += 1;
                const gk = ogrenciGrupKimligi(v);
                if(!juriGruplari[gk]) juriGruplari[gk] = { macId:mid, mac:ml, okul:secim.okul||'-', ogrenci:ogrKisa, juriler:new Set(), toplam:0, sayac:0 };
                if(secim.juri) juriGruplari[gk].juriler.add(secim.juri);
                juriGruplari[gk].toplam += toplamPuan;
                juriGruplari[gk].sayac += 1;
            }
            if(secim.okul) {
                if(!okulPuanlari[secim.okul]) okulPuanlari[secim.okul]=0;
                okulPuanlari[secim.okul] += toplamPuan;
            }
        });
        // İlgili kategorideki fikstür maçları, henüz puan girilmemiş olsa da kapsamda tutulur.
        Object.entries(maclarMap||{}).forEach(([id,m])=>{
            if(m?.hukOkul && m?.muhOkul && !mSet.has(id))
                mSet.set(id,m.etiket||macEtiketi(m.hukOkul,m.muhOkul));
        });
        const siraliList = Object.keys(ogrenciPuanlari).map(isim=>({isim,ortalama:Number((ogrenciPuanlari[isim].skor/ogrenciPuanlari[isim].sayac).toFixed(1)),juriSayisi:ogrenciPuanlari[isim].sayac})).sort((a,b)=>b.ortalama-a.ortalama);
        const podium=document.getElementById('mvp-podium');
        if(siraliList.length){podium.innerHTML=''; for(let i=0;i<Math.min(3,siraliList.length);i++) podium.innerHTML += `<div class="summary-row"><span class="summary-name">${htmlEscape(siraliList[i].isim.split(' (')[0])}</span><span class="summary-score">${siraliList[i].ortalama.toFixed(1)} Ort.</span></div>`;} else podium.innerHTML='Veri yok.';
        const siraliOkullar=Object.keys(okulPuanlari).map(oAd=>({isim:oAd,toplam:okulPuanlari[oAd]})).sort((a,b)=>b.toplam-a.toplam);
        const schoolBoard=document.getElementById('school-leaderboard');
        if(siraliOkullar.length){schoolBoard.innerHTML=''; siraliOkullar.forEach((x,i)=>schoolBoard.innerHTML += `<div class="summary-row"><span class="summary-name">${i+1}. ${htmlEscape(x.isim)}</span><span class="summary-score">${x.toplam} Puan</span></div>`);} else schoolBoard.innerHTML='Veri yok.';
        const juriRows=Object.values(juriGruplari).sort((a,b)=>(a.mac+a.okul+a.ogrenci).localeCompare(b.mac+b.okul+b.ogrenci,'tr'));
        const tamSayisi=juriRows.filter(x=>BEKLENEN_JURILER.every(j=>x.juriler.has(j))).length;
        const eksikSayisi=juriRows.length-tamSayisi;
        const metrics=document.getElementById('adminMetrics');
        if(metrics) metrics.innerHTML=`<div class="admin-metric"><span>Tekil Puan Kaydı</span><strong>${kayitlar.length}</strong></div><div class="admin-metric"><span>Puanlanan Öğrenci/Maç</span><strong>${juriRows.length}</strong></div><div class="admin-metric"><span>3/3 Jüri Tamam</span><strong>${tamSayisi}</strong></div><div class="admin-metric"><span>Jürisi Eksik</span><strong>${eksikSayisi}</strong></div>`;
        const coverage=document.getElementById('juryCoverage');
        if(coverage){let html='<table class="tutanak-table"><tr><th>Maç</th><th>Okul</th><th>Öğrenci</th><th>Jüri Durumu</th><th>Eksik Jüri</th><th>Ortalama</th></tr>'; juriRows.forEach(x=>{const eksikler=BEKLENEN_JURILER.filter(j=>!x.juriler.has(j)); const tam=!eksikler.length; const ort=x.sayac?(x.toplam/x.sayac).toFixed(1):'-'; html += `<tr><td>${htmlEscape(x.mac)}</td><td>${htmlEscape(x.okul)}</td><td>${htmlEscape(x.ogrenci)}</td><td class="${tam?'jury-ok':'jury-missing'}">${x.juriler.size}/3</td><td>${tam?'—':htmlEscape(eksikler.join(', '))}</td><td>${ort}</td></tr>`;}); coverage.innerHTML=html+'</table>';}
        sonRaporVerisi={kategori:secimler.kategori,kayitlar,juriRows,siraliList,siraliOkullar,maclarMap,resmiFikstur,taslaklar:taslaklar||{}};
        taslakPuanAnaliziniGoster();
        raporGunSecenekleriniDoldur();
        tutanakTablosuDoldur();
    }

    // Taslak puanlar yalnızca yöneticiye yönelik varsayımsal analizde kullanılır.
    // Resmî puanları, kesinleşmiş sonucu veya turnuva ağacını hiçbir şekilde değiştirmez.
    function taslakPuanAnaliziniDerle(veri=sonRaporVerisi){
        if(!veri)return {kayitlar:[],maclar:[]};
        const kayitlar=[],resmiKimlikler=new Set();
        for(const v of veri.kayitlar||[]){
            const s=v.secim||{};
            resmiKimlikler.add([kayitMacId(v),s.juri||'',s.okul||'',s.ogr||''].map(x=>puanMetniNormalize(x).toLocaleLowerCase('tr-TR')).join('|'));
        }
        for(const [macId,grup] of Object.entries(veri.taslaklar||{})){
            for(const [kayitId,v] of Object.entries(grup||{})){
                if(!v||v.durum==='gonderildi')continue;
                const s=v.secim||{};
                const kimlik=[macId,s.juri||'',s.okul||'',s.ogr||''].map(x=>puanMetniNormalize(x).toLocaleLowerCase('tr-TR')).join('|');
                if(resmiKimlikler.has(kimlik))continue;
                const puanlar=v.puanlar||{};
                let toplam=0,dolu=0;
                const eksik=[];
                const ayrinti=krit.map((k,i)=>{
                    const raw=puanlar[i]??puanlar[String(i)];
                    const n=Number(raw);
                    const valid=raw!==null&&raw!==undefined&&raw!==''&&Number.isInteger(n)&&n>=1&&n<=k.m;
                    if(valid){toplam+=n;dolu++;}
                    else eksik.push(i+1);
                    return valid?n:0;
                });
                const m=veri.maclarMap?.[macId]||{};
                let taraf='';
                if(skorEslesmeAnahtari(s.okul)===skorEslesmeAnahtari(m.hukOkul))taraf='huk';
                else if(skorEslesmeAnahtari(s.okul)===skorEslesmeAnahtari(m.muhOkul))taraf='muh';
                else if(s.taraf==='HÜKÜMET')taraf='huk';
                else if(s.taraf==='MUHALEFET')taraf='muh';
                kayitlar.push({macId,kayitId,juri:s.juri||'—',juriAd:s.juriAd||'—',
                    okul:s.okul||'—',ogrenci:(s.ogr||'').split(' (')[0]||'—',
                    dolu,eksikSayisi:13-dolu,eksikKriterler:eksik.join(', ')||'—',
                    toplam,taraf,ayrinti,durum:v.durum||'taslak',updatedAt:v.updatedAt||v.localUpdatedAt||null});
            }
        }
        const macGruplari=new Map();
        for(const x of kayitlar){
            if(!macGruplari.has(x.macId))macGruplari.set(x.macId,[]);
            macGruplari.get(x.macId).push(x);
        }
        const maclar=[];
        for(const [macId,items] of macGruplari){
            const m=veri.maclarMap?.[macId]||{};
            const resmi=raporTakimVerisiniDerle(veri).find(x=>x.id===macId);
            const resmiH=(resmi?.roles||[]).reduce((t,x)=>t+x.huk,0);
            const resmiM=(resmi?.roles||[]).reduce((t,x)=>t+x.muh,0);
            const taslakH=items.filter(x=>x.taraf==='huk').reduce((t,x)=>t+x.toplam,0);
            const taslakM=items.filter(x=>x.taraf==='muh').reduce((t,x)=>t+x.toplam,0);
            const toplamH=resmiH+taslakH,toplamM=resmiM+taslakM;
            const varsayimKazanan=toplamH>toplamM?(m.hukOkul||'Hükümet'):toplamM>toplamH?(m.muhOkul||'Muhalefet'):'Eşit';
            maclar.push({macId,mac:m.etiket||macEtiketi(m.hukOkul||'Hükümet',m.muhOkul||'Muhalefet'),
                resmiH,resmiM,taslakH,taslakM,toplamH,toplamM,varsayimKazanan,kayitSayisi:items.length});
        }
        return {kayitlar,maclar};
    }

    function taslakPuanAnaliziniGoster(){
        const host=document.getElementById('taslakPuanAnalizi');
        if(!host||!adminYetkiliMi()||!sonRaporVerisi)return;
        const analiz=taslakPuanAnaliziniDerle();
        sonRaporVerisi.taslakAnalizi=analiz;
        if(!analiz.kayitlar.length){
            host.innerHTML='<h3 style="margin-top:0;color:var(--text-main)">🧮 Eksik Taslak Puan Analizi</h3><div class="puanlama-bilgi">Bu kategoride resmî kaydı bulunmayan taslak puan yok. Resmî sonuçlar değişmez.</div>';
            return;
        }
        let html='<h3 style="margin-top:0;color:var(--text-main)">🧮 Eksik Taslak Puan Analizi</h3><div class="puanlama-bilgi">Boş veya geçersiz kriterler bu simülasyonda <b>0 puan</b> kabul edilir. Taslaklar yalnızca aşağıdaki varsayımsal hesaba eklenir; resmî puanlara, kesinleşmiş galibe ve turnuva ağacına yazılmaz.</div>';
        html+='<div style="overflow-x:auto"><table class="tutanak-table"><tr><th>Maç</th><th>Okul</th><th>Öğrenci</th><th>Jüri</th><th>Dolu</th>'+krit.map((k,i)=>'<th>'+ (i+1) +'</th>').join('')+'<th>Eksik Kriter</th><th>Taslak Puanı</th></tr>';
        for(const x of analiz.kayitlar)html+='<tr><td>'+htmlEscape(x.macId)+'</td><td>'+htmlEscape(x.okul)+'</td><td>'+htmlEscape(x.ogrenci)+'</td><td>'+htmlEscape(x.juriAd)+' ('+htmlEscape(x.juri)+')</td><td>'+x.dolu+'/13</td>'+x.ayrinti.map(n=>'<td>'+n+'</td>').join('')+'<td>'+htmlEscape(x.eksikKriterler)+'</td><td><b>'+x.toplam+'</b></td></tr>';
        html+='</table></div>';
        html+='<h4 style="color:var(--text-main);margin:18px 0 8px">Taslaklar eklenirse varsayımsal maç puanları</h4><div style="overflow-x:auto"><table class="tutanak-table"><tr><th>Maç</th><th>Resmî ham H/M</th><th>Taslak H/M</th><th>Varsayımsal toplam H/M</th><th>Varsayımsal üstün</th></tr>';
        for(const x of analiz.maclar)html+='<tr><td>'+htmlEscape(x.mac)+'</td><td>'+x.resmiH+' / '+x.resmiM+'</td><td>'+x.taslakH+' / '+x.taslakM+'</td><td><b>'+x.toplamH+' / '+x.toplamM+'</b></td><td><b>'+htmlEscape(x.varsayimKazanan)+'</b></td></tr>';
        html+='</table></div>';
        host.innerHTML=html;
    }

    // V3.21 - Gün seçmeli resmî takım puan tutanağı: öğrenci kayıtları ayrıntıda korunur.
    // Resmî galip veya kesinleşmiş puanlar ham jüri puanlarıyla asla değiştirilmez.
    function raporYerelBugunAnahtari() {
        const d=new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function raporGunAnahtariSatirdan(m) {
        return raporFiksturTarihAnahtari(m?.fiksturTarih||m?.tarih||'');
    }

    function raporGunFiltresineUyar(m, secili= document.getElementById('gunFiltre')?.value||'hepsi') {
        if(secili==='hepsi')return true;
        const tarih=raporGunAnahtariSatirdan(m);
        return secili==='tarihsiz' ? !tarih : tarih===secili;
    }

    function raporGunSecenekleriniDoldur() {
        const select=document.getElementById('gunFiltre');
        if(!select||!sonRaporVerisi)return;
        const onceki=select.value;
        const gunler=new Map();
        for(const r of raporTakimVerisiniDerle(sonRaporVerisi)){
            const raw=String(r.m?.fiksturTarih||r.m?.tarih||'').trim();
            const key=raporGunAnahtariSatirdan(r.m);
            if(key){if(!gunler.has(key))gunler.set(key,raw||key);}
            else if(!gunler.has('tarihsiz'))gunler.set('tarihsiz','Tarihi henüz belirlenmeyen maçlar');
        }
        const tarihli=[...gunler.entries()].filter(([k])=>k!=='tarihsiz').sort((a,b)=>a[0].localeCompare(b[0]));
        let html='<option value="hepsi">Tüm Günler (genel rapor)</option>';
        for(const [key,label] of tarihli)html+=`<option value="${htmlEscape(key)}">${htmlEscape(label)}</option>`;
        if(gunler.has('tarihsiz'))html+=`<option value="tarihsiz">${htmlEscape(gunler.get('tarihsiz'))}</option>`;
        select.innerHTML=html;
        const mevcutGecerli=onceki && [...select.options].some(o=>o.value===onceki);
        const ilkGun=tarihli[0]?.[0]||(gunler.has('tarihsiz')?'tarihsiz':'hepsi');
        select.value=mevcutGecerli?onceki:(gunler.has(raporYerelBugunAnahtari())?raporYerelBugunAnahtari():ilkGun);
    }

    function raporFiksturTarihAnahtari(tarih) {
        const s=String(tarih||'').trim();
        const iso=s.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
        if(iso)return `${iso[1]}-${iso[2].padStart(2,'0')}-${iso[3].padStart(2,'0')}`;
        const tr=s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2})/);
        if(tr)return `${tr[3]}-${tr[2].padStart(2,'0')}-${tr[1].padStart(2,'0')}`;
        const aylar=['ocak','şubat','mart','nisan','mayıs','haziran','temmuz','ağustos','eylül','ekim','kasım','aralık'];
        const parca=s.toLocaleLowerCase('tr-TR').match(/^(\d{1,2})\s+(\S+)\s+(20\d{2})/);
        if(parca){const ix=aylar.indexOf(parca[2]);if(ix>=0)return `${parca[3]}-${String(ix+1).padStart(2,'0')}-${parca[1].padStart(2,'0')}`;}
        return '';
    }

    function raporTakimVerisiniDerle(veri=sonRaporVerisi) {
        if(!veri)return [];
        const tum=new Map(Object.entries(veri.maclarMap||{}));
        for(const v of veri.kayitlar){
            const id=kayitMacId(v),s=v.secim||{};
            if(!tum.has(id)&&s.hukOkul&&s.muhOkul)
                tum.set(id,{id,etiket:kayitMacEtiketi(v),hukOkul:s.hukOkul,muhOkul:s.muhOkul,durum:'acik'});
        }
        const kategori=veri.kategori==='LİSE'?'lise':'ortaokul';
        const jurilerTarih=veri.resmiFikstur?.juries||{};
        const sonuclar=veri.resmiFikstur?.finalizedMatches||{};
        const rows=[];
        for(const [id,m] of tum){
            if(!m?.hukOkul||!m?.muhOkul)continue;
            const votes=veri.kayitlar.filter(v=>kayitMacId(v)===id);
            const roleScores=BEKLENEN_JURILER.map(()=>({huk:0,muh:0,hukKayit:0,muhKayit:0,names:new Set()}));
            let bekleyenPuan=false;
            for(const v of votes){
                const x=v.secim||{};
                const ix=BEKLENEN_JURILER.indexOf(x.juri);
                if(ix<0)continue;
                const name=puanMetniNormalize(x.juriAd||v.juriAd||'');
                if(name)roleScores[ix].names.add(name);
                const hangi=(skorEslesmeAnahtari(x.okul)===skorEslesmeAnahtari(m.hukOkul)||skorEslesmeAnahtari(x.okul)===skorEslesmeAnahtari(m.ogrenciKaynaklari?.huk))?'huk':
                    (skorEslesmeAnahtari(x.okul)===skorEslesmeAnahtari(m.muhOkul)||skorEslesmeAnahtari(x.okul)===skorEslesmeAnahtari(m.ogrenciKaynaklari?.muh))?'muh':
                    x.taraf==='HÜKÜMET'?'huk':x.taraf==='MUHALEFET'?'muh':null;
                if(!hangi)continue;
                const valid=krit.every((k,i)=>{const n=Number(v.puanlar?.[i]??v.puanlar?.[String(i)]);return Number.isInteger(n)&&n>=1&&n<=k.m;});
                if(!valid){bekleyenPuan=true;continue;}
                roleScores[ix][hangi]+=puanToplami(v);
                roleScores[ix][hangi+'Kayit']++;
            }
            const date=raporFiksturTarihAnahtari(m.fiksturTarih||m.tarih||'');
            const gorevli=jurilerTarih[date]?.[kategori]||{};
            const gorevliRoller=['asil1','asil2','asil3'];
            const names=roleScores.map((x,i)=>{
                if(x.names.size)return {name:[...x.names].join(' / '),kaynak:'puan',coklu:x.names.size>1};
                const n=puanMetniNormalize(gorevli[gorevliRoller[i]]?.name||'');
                return {name:n||'—',kaynak:n?'fikstur':'eksik',coklu:false};
            });
            const rawH=roleScores.reduce((t,x)=>t+x.huk,0),rawM=roleScores.reduce((t,x)=>t+x.muh,0);
            const resmi=sonuclar[m.fiksturNo]||m.sonuc||{};
            const saved=(m.durum==='kapali' && m.sonuc)?m.sonuc:resmi;
            const puanH=typeof saved.puanHuk==='number'&&Number.isFinite(saved.puanHuk)?saved.puanHuk:(rawH||null);
            const puanM=typeof saved.puanMuh==='number'&&Number.isFinite(saved.puanMuh)?saved.puanMuh:(rawM||null);
            const sure=m.sureEsitlik||{};
            const auto=otomatikSureleriDerle(m);
            const sureH=sure.hukSaniye??(auto.ogrenciler.huk.length?auto.toplam.huk:null);
            const sureM=sure.muhSaniye??(auto.ogrenciler.muh.length?auto.toplam.muh:null);
            const kazanan=saved.kazanan||'';
            const cift=saved.yontem==='cift_eleme';
            const sonucVar=!!kazanan||cift;
            const durum=cift?'İki okul elendi':sonucVar?'Kesinleşti':m.durum==='iptal'?'İptal':bekleyenPuan?'Eksik puan':votes.length?'Değerlendirme sürüyor':'Henüz puan yok';
            rows.push({id,m,roles:roleScores,names,puanH,puanM,sureH,sureM,kazanan,
                cift,sonucVar,durum,puanKayitSayisi:votes.length,resmi,saved});
        }
        return rows.sort((a,b)=>(Number(a.m.fiksturNo)||999999)-(Number(b.m.fiksturNo)||999999)||
            String(a.m.etiket||'').localeCompare(String(b.m.etiket||''),'tr'));
    }

    function raporTakimTablosuHtml(rows,imzali=false) {
        const nameCells=imzali?'<th>1. Jüri / Adı</th><th>2. Jüri / Adı</th><th>3. Jüri / Adı</th><th>1. İmza</th><th>2. İmza</th><th>3. İmza</th>':
            '<th>1. Jüri / Adı</th><th>2. Jüri / Adı</th><th>3. Jüri / Adı</th>';
        let html=`<table class="${imzali?'toplu-print-table':'tutanak-table takim-ekran-tablosu'}"><thead><tr>
            <th>No</th><th>Tarih</th><th>Hükümet Takımı</th><th>Muhalefet Takımı</th>
            <th>1. Jüri H/M</th><th>2. Jüri H/M</th><th>3. Jüri H/M</th>
            <th>H Puan</th><th>M Puan</th><th>Süre H/M</th><th>Kazanan / Sonuç</th>
            ${nameCells}</tr></thead><tbody>`;
        rows.forEach((r,i)=>{
            const data=r.roles.map(x=>x.hukKayit||x.muhKayit?`${x.hukKayit?x.huk:'—'} / ${x.muhKayit?x.muh:'—'}`:'—');
            const resmiNot=r.sonucVar?'':' <small>(kısmi)</small>';
            const sonuc=r.cift?'Galip yok – çift eleme':r.kazanan||r.durum;
            const tarih=r.m.fiksturTarih||'—';
            const sign=imzali?'<td class="imza-bos"></td><td class="imza-bos"></td><td class="imza-bos"></td>':'';
            html+=`<tr data-rapor-mac-id="${htmlEscape(r.id)}" class="${r.sonucVar?'kesin-sonuc':''}"><td>${htmlEscape(r.m.fiksturNo||i+1)}</td>
                <td>${htmlEscape(tarih)}</td><td>${htmlEscape(r.m.hukOkul)}</td><td>${htmlEscape(r.m.muhOkul)}</td>
                ${data.map(v=>`<td class="num-cell">${v}</td>`).join('')}
                <td class="num-cell"><b>${r.puanH??'—'}</b>${resmiNot}</td>
                <td class="num-cell"><b>${r.puanM??'—'}</b>${resmiNot}</td>
                <td class="num-cell">${r.sureH!=null?sureyiMetneDonustur(r.sureH):'—'} / ${r.sureM!=null?sureyiMetneDonustur(r.sureM):'—'}</td>
                <td><b>${htmlEscape(sonuc)}</b></td>
                ${r.names.map(n=>`<td>${htmlEscape(n.name)}${n.kaynak==='fikstur'?'<sup>*</sup>':''}</td>`).join('')}
                ${sign}</tr>`;
        });
        return html+(rows.length?'':'<tr><td colspan="17">Henüz karşılaşma bulunamadı.</td></tr>')+'</tbody></table>';
    }

    function raporKompaktYazdirDoldur() {
        const host=document.getElementById('raporKompaktYazdir');
        if(!host||!sonRaporVerisi)return;
        const secili=document.getElementById('gunFiltre')?.value||'hepsi';
        const rows=raporTakimVerisiniDerle().filter(r=>raporGunFiltresineUyar(r.m,secili));
        const gunEtiketi=document.getElementById('gunFiltre')?.selectedOptions?.[0]?.textContent||'Tüm Günler';
        let html=`<header class="toplu-print-head"><h2>T.C. IĞDIR İL MİLLÎ EĞİTİM MÜDÜRLÜĞÜ</h2>
            <h3>OKULLAR ARASI MÜNAZARA TURNUVASI · TAKIM SONUÇ VE İMZA TUTANAĞI</h3>
            <p><strong>${htmlEscape(sonRaporVerisi.kategori)}</strong> &nbsp;|&nbsp; <strong>Tutanak Günü: ${htmlEscape(gunEtiketi)}</strong>
            &nbsp;|&nbsp; ${rows.length} karşılaşma</p></header>`;
        html+=raporTakimTablosuHtml(rows,true);
        html+=`<footer class="toplu-print-footer">
            <p><b>H / M:</b> Hükümet / Muhalefet. Jüri sütunları ilgili jüriye ait öğrenci puanlarının takım toplamıdır.
            Puanı eksik maçlardaki ara toplamlar resmî sonuç değildir. <b>*</b> Jüri adı puan kaydında yoksa Firebase görevlendirme çizelgesinden alınmıştır.
            İmza alanları her maçın karşısında yer alır; öğrenci puan ayrıntıları elektronik kayıtta saklıdır.</p>
            <div class="toplu-komisyon"><span>Tutanak Düzenleyen / Adı Soyadı / İmza: ....................................</span>
            <span>Kontrol Eden / Adı Soyadı / İmza: ....................................</span></div>
        </footer>`;
        host.innerHTML=html;
        const size=rows.length>13?'A3':'A4';
        host.dataset.printSize=size;
        host.dataset.rowCount=String(rows.length);
        const style=document.getElementById('topluDinamikSayfa')||document.createElement('style');
        style.id='topluDinamikSayfa';
        style.textContent=`@media print { @page { size: ${size} landscape; margin: ${size==='A3'?'6mm 7mm':'5mm 5mm'}; } }`;
        if(!style.parentNode)document.head.appendChild(style);
        // Küçük font yalnızca çok maçın aynı fiziki sayfaya sığması gerektiğinde kullanılır.
        host.style.setProperty('--rapor-yazi',rows.length>50?'5.3pt':rows.length>32?'6.2pt':rows.length>13?'7.2pt':'7.3pt');
        host.style.setProperty('--rapor-bosluk',rows.length>38?'2px 2px':rows.length>20?'3px 3px':'4px 4px');
        // İmzalanabilir satır yüksekliği: az maçta geniş, çok maçta tek sayfayı korur.
        host.style.setProperty('--rapor-satir',Math.min(14,(size==='A3'?183:128)/Math.max(rows.length,1)).toFixed(2)+'mm');
        host.style.setProperty('--rapor-zoom',rows.length>65?'0.62':rows.length>50?'0.78':'1');
    }

    function raporTakimYazdir(){
        if(!adminYetkiliMi())return alert('Tutanak yalnızca yönetici tarafından yazdırılabilir.');
        if(!sonRaporVerisi)return alert('Rapor verileri henüz yüklenmedi.');
        raporKompaktYazdirDoldur();
        window.print();
    }

    // Sonuç ekranı açıldığında veya gün filtresi değiştiğinde görünür tablodaki
    // aktif maça; yoksa bugünün sıradaki, gün bittiyse son maçına kendiliğinden gider.
    function raporSonucMacinaOtomatikOdaklan(rows){
        const root=document.getElementById('rapor-tablosu');
        if(!root||!Array.isArray(rows)||!rows.length)return;
        const simdi=Date.now();
        const bugun=raporYerelBugunAnahtari();
        const zamanli=rows.map(r=>({r,ar:puanlamaMacSaatAraliginiCoz(r.m)})).filter(x=>x.ar);
        const aktif=zamanli.filter(x=>x.ar.baslangic<=simdi && simdi<=x.ar.bitis);
        let hedef=aktif.length===1?aktif[0].r:null;
        if(!hedef && aktif.length>1){
            // Çakışan seans varsa rastgele seçme; listede ilk görünen maç kullanılabilir.
            hedef=aktif.sort((a,b)=>a.ar.baslangic-b.ar.baslangic)[0].r;
        }
        if(!hedef){
            const siradakiBugun=zamanli.filter(x=>x.ar.tarihKey===bugun && x.ar.baslangic>simdi && !['kapali','iptal'].includes(x.r.m?.durum))
                .sort((a,b)=>a.ar.baslangic-b.ar.baslangic);
            if(siradakiBugun.length)hedef=siradakiBugun[0].r;
        }
        if(!hedef){
            const gecmisBugun=zamanli.filter(x=>x.ar.tarihKey===bugun && x.ar.bitis<simdi)
                .sort((a,b)=>b.ar.baslangic-a.ar.baslangic);
            if(gecmisBugun.length)hedef=gecmisBugun[0].r;
        }
        if(!hedef){
            const siradaki=zamanli.filter(x=>x.ar.baslangic>simdi && !['kapali','iptal'].includes(x.r.m?.durum))
                .sort((a,b)=>a.ar.baslangic-b.ar.baslangic);
            if(siradaki.length)hedef=siradaki[0].r;
        }
        if(!hedef && zamanli.length){
            hedef=zamanli.slice().sort((a,b)=>b.ar.baslangic-a.ar.baslangic)[0].r;
        }
        if(!hedef)hedef=rows[0];
        const satir=[...root.querySelectorAll('tr[data-rapor-mac-id]')].find(el=>el.dataset.raporMacId===String(hedef.id));
        if(!satir)return;
        root.querySelectorAll('tr.rapor-otomatik-hedef').forEach(el=>el.classList.remove('rapor-otomatik-hedef'));
        satir.classList.add('rapor-otomatik-hedef');
        // DOM'un yerleşmesi için kısa gecikme; yönetici aşağı kaydırmak zorunda kalmaz.
        window.setTimeout(()=>{
            if(!satir.isConnected)return;
            satir.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'});
        },120);
    }

    function tutanakTablosuDoldur(){
        if(!adminYetkiliMi())return;
        const root=document.getElementById('rapor-tablosu');
        if(!root||!sonRaporVerisi)return;
        const secili=document.getElementById('gunFiltre')?.value||'hepsi';
        const rows=raporTakimVerisiniDerle().filter(x=>raporGunFiltresineUyar(x.m,secili));
        let html=`<h3 style="color:var(--text-main)">Takım Bazlı Puan ve Sonuç Özeti</h3>
            <div class="puanlama-bilgi">Her maç tek satırdır. Süreler takım toplamıdır. Jüri adı önce sistemdeki gerçek puan kaydından, yoksa resmî fikstür görevlendirmesinden alınır. Kesinleşmemiş skorlar resmî sonuç değildir.</div>`;
        html+=`<div style="overflow-x:auto">${raporTakimTablosuHtml(rows)}</div>`;
        html+='<details class="ogrenci-detay-karti no-print"><summary>Öğrenci Bazlı Ayrıntılı Kayıtları Göster (13 kriter ve jüri puanları)</summary>';
        html+='<div style="overflow-x:auto"><table class="tutanak-table"><tr><th>Taraf</th><th>Okul</th><th>Öğrenci</th><th>Jüri No</th><th>Jüri Adı</th>'+krit.map((k,i)=>`<th>${i+1}</th>`).join('')+'<th>Toplam</th></tr>';
        for(const v of sonRaporVerisi.kayitlar){
            const kayitMac=sonRaporVerisi.maclarMap?.[kayitMacId(v)]||{};
            if(!raporGunFiltresineUyar(kayitMac,secili))continue;
            const p=krit.map((_k,i)=>v.puanlar?.[i]??v.puanlar?.[String(i)]??'—');
            html+=`<tr><td>${htmlEscape(v.secim?.taraf||'')}</td><td>${htmlEscape(v.secim?.okul||'')}</td>
                <td>${htmlEscape((v.secim?.ogr||'').split(' (')[0])}</td><td>${htmlEscape(v.secim?.juri||'')}</td>
                <td>${htmlEscape(v.secim?.juriAd||'—')}</td>${p.map(x=>`<td>${htmlEscape(x)}</td>`).join('')}
                <td><b>${puanToplami(v)}</b></td></tr>`;
        }
        root.innerHTML=html+'</table></div></details>';
        // Ekrandaki günlük seçim ile PDF tutanağı aynı gün kapsamını kullanır.
        raporKompaktYazdirDoldur();
        // Günün / o anki maçının satırını vurgula ve otomatik olarak görünür alana getir.
        raporSonucMacinaOtomatikOdaklan(rows);
    }

    function raporuExcelIndir() {
        if(!adminYetkiliMi())return alert('Rapor yalnızca yönetici tarafından indirilebilir.');
        if(!sonRaporVerisi)return alert('Excel için rapor verileri henüz yüklenmedi.');

        const kategori=sonRaporVerisi.kategori;
        const resmi=sonRaporVerisi.resmiFikstur||{};
        const tumMacRaporlari=raporTakimVerisiniDerle();

        // Excel, okullara gönderilecek aktif iş listesidir. Kesinleşmiş veya kapatılmış
        // maçlar hiçbir sayfaya alınmaz. Kontrol hem maç kaydını hem resmî fikstürü okur.
        function macTamamlandiMi(id, mac={}, raporSatiri=null){
            const no=Number(mac?.fiksturNo||raporSatiri?.m?.fiksturNo||0);
            const finalKaydi=no>0?resmi.finalizedMatches?.[no]:null;
            const elenmeKaydi=no>0?resmi.noWinnerMatches?.[no]:null;
            const finalKategoriUygun=!finalKaydi?.kategori||finalKaydi.kategori===kategori;
            const finalMacUygun=!finalKaydi?.macId||finalKaydi.macId===id;
            const elenmeKategoriUygun=!elenmeKaydi?.kategori||elenmeKaydi.kategori===kategori;
            const elenmeMacUygun=!elenmeKaydi?.macId||elenmeKaydi.macId===id;
            return String(mac?.durum||'').toLocaleLowerCase('tr-TR')==='kapali'
                || mac?.sonuc?.yontem==='cift_eleme'
                || !!raporSatiri?.sonucVar
                || !!(finalKaydi&&finalKategoriUygun&&finalMacUygun)
                || !!(elenmeKaydi&&elenmeKategoriUygun&&elenmeMacUygun);
        }

        const bitmisMacIdleri=new Set(tumMacRaporlari
            .filter(r=>macTamamlandiMi(r.id,r.m,r))
            .map(r=>r.id));
        const aktifMacRaporlari=tumMacRaporlari.filter(r=>!bitmisMacIdleri.has(r.id));
        const aktifMacIdleri=new Set(aktifMacRaporlari.map(r=>r.id));
        const aktifKayitlar=(sonRaporVerisi.kayitlar||[])
            .filter(v=>aktifMacIdleri.has(kayitMacId(v)));

        const puanRows=aktifKayitlar.map(v=>{
            const mid=kayitMacId(v);
            const m=sonRaporVerisi.maclarMap?.[mid]||{};
            const satir={
                'Kategori':kategori,'Maç ID':mid,'Maç':kayitMacEtiketi(v),'Maç Durumu':m.durum||'Açık',
                'Taraf':v.secim?.taraf||'','Okul':v.secim?.okul||'',
                'Öğrenci':(v.secim?.ogr||'').split(' (')[0],'Jüri':v.secim?.juri||'',
                'Jüri Adı':v.secim?.juriAd||''
            };
            krit.forEach((k,i)=>satir[`${i+1}. ${k.t}`]=Number(v.puanlar?.[i]??v.puanlar?.[String(i)]??0));
            satir['Toplam']=puanToplami(v);
            satir['Son Güncelleme']=v.updatedAt&&typeof v.updatedAt==='number'?new Date(v.updatedAt).toLocaleString('tr-TR'):'';
            return satir;
        });

        const juriRows=(sonRaporVerisi.juriRows||[])
            .filter(x=>aktifMacIdleri.has(x.macId))
            .map(x=>{
                const eksikler=BEKLENEN_JURILER.filter(j=>!x.juriler.has(j));
                return {'Maç ID':x.macId,'Maç':x.mac,'Okul':x.okul,'Öğrenci':x.ogrenci,
                    'Jüri Sayısı':x.juriler.size,'Tamamlayan Jüriler':[...x.juriler].join(', '),
                    'Eksik Jüriler':eksikler.join(', '),'Ortalama':x.sayac?Number((x.toplam/x.sayac).toFixed(1)):''};
            });

        // Okul toplamları ve MVP ortalamaları yalnızca henüz tamamlanmamış maçlardan hesaplanır.
        const aktifOgrenciPuanlari={},aktifOkulPuanlari={};
        for(const v of aktifKayitlar){
            const toplam=puanToplami(v),secim=v.secim||{};
            const ogrKisa=(secim.ogr||'').split(' (')[0];
            if(secim.ogr){
                const temizIsim=ogrKisa+' ('+(secim.okul||'-')+')';
                if(!aktifOgrenciPuanlari[temizIsim])aktifOgrenciPuanlari[temizIsim]={skor:0,sayac:0};
                aktifOgrenciPuanlari[temizIsim].skor+=toplam;
                aktifOgrenciPuanlari[temizIsim].sayac++;
            }
            if(secim.okul){
                if(!aktifOkulPuanlari[secim.okul])aktifOkulPuanlari[secim.okul]=0;
                aktifOkulPuanlari[secim.okul]+=toplam;
            }
        }
        const okulRows=Object.keys(aktifOkulPuanlari)
            .map(isim=>({isim,toplam:aktifOkulPuanlari[isim]}))
            .sort((a,b)=>b.toplam-a.toplam)
            .map((x,i)=>({'Sıra':i+1,'Okul':x.isim,'Toplam Puan':x.toplam}));
        const mvpRows=Object.keys(aktifOgrenciPuanlari)
            .map(isim=>({isim,ortalama:Number((aktifOgrenciPuanlari[isim].skor/aktifOgrenciPuanlari[isim].sayac).toFixed(1)),juriSayisi:aktifOgrenciPuanlari[isim].sayac}))
            .sort((a,b)=>b.ortalama-a.ortalama)
            .map((x,i)=>({'Sıra':i+1,'Öğrenci':x.isim.split(' (')[0],'Okul':(x.isim.match(/\((.*)\)$/)||[])[1]||'','Ortalama':x.ortalama,'Jüri Kaydı':x.juriSayisi}));

        const sureRows=[];
        Object.entries(sonRaporVerisi.maclarMap||{}).forEach(([id,m])=>{
            if(!aktifMacIdleri.has(id)||macTamamlandiMi(id,m))return;
            for(const taraf of ['huk','muh'])for(const x of (m.sureEsitlik?.ogrenciler?.[taraf]||[])){
                sureRows.push({'Kategori':kategori,'Maç ID':id,'Maç':m.etiket||'',
                    'Okul':taraf==='huk'?m.hukOkul:m.muhOkul,'Taraf':taraf==='huk'?'HÜKÜMET':'MUHALEFET',
                    'Öğrenci':x.ad,'Süre (Saniye)':x.saniye,'Süre (DD:SS)':sureyiMetneDonustur(x.saniye),
                    'Kayıt Türü':'Onaylı resmî süre'});
            }
            Object.values(m.konusmaSayaclari||{}).forEach(v=>{
                if(!v?.ogrenci)return;
                const s=ortakSureKalan(v);
                if(!s?.bitti)return;
                sureRows.push({'Kategori':kategori,'Maç ID':id,'Maç':m.etiket||'',
                    'Okul':v.okul||'','Taraf':v.taraf||'','Öğrenci':v.ogrenci,
                    'Süre (Saniye)':s.gecen,'Süre (DD:SS)':sureyiMetneDonustur(s.gecen),
                    'Kayıt Türü':'Jüri ortak sayacı (resmî onay bekleyebilir)'});
            });
        });

        const sureToplamRows=Object.entries(sonRaporVerisi.maclarMap||{})
            .filter(([id,m])=>aktifMacIdleri.has(id)&&!macTamamlandiMi(id,m))
            .map(([id,m])=>{
                const o=otomatikSureleriDerle(m),v=m.sureEsitlik;
                return {'Maç ID':id,'Maç':m.etiket||'','Hükümet Okulu':m.hukOkul,
                    'Muhalefet Okulu':m.muhOkul,
                    'Hükümet Toplam Saniye':v?.hukSaniye??(o.ogrenciler.huk.length?o.toplam.huk:''),
                    'Muhalefet Toplam Saniye':v?.muhSaniye??(o.ogrenciler.muh.length?o.toplam.muh:''),
                    'Hükümet Öğrenci Sayısı':v?.ogrenciler?.huk?.length??o.ogrenciler.huk.length,
                    'Muhalefet Öğrenci Sayısı':v?.ogrenciler?.muh?.length??o.ogrenciler.muh.length,
                    'Kaynak':v?.kaynak||'Ortak sayaçlardan'};
            });

        const takimRows=aktifMacRaporlari.map(r=>({
            'Kategori':kategori,'Maç No':r.m.fiksturNo||'','Tarih':r.m.fiksturTarih||'',
            'Hükümet Okulu':r.m.hukOkul,'Muhalefet Okulu':r.m.muhOkul,
            '1. Jüri Hükümet':r.roles[0].hukKayit?r.roles[0].huk:'',
            '1. Jüri Muhalefet':r.roles[0].muhKayit?r.roles[0].muh:'',
            '2. Jüri Hükümet':r.roles[1].hukKayit?r.roles[1].huk:'',
            '2. Jüri Muhalefet':r.roles[1].muhKayit?r.roles[1].muh:'',
            '3. Jüri Hükümet':r.roles[2].hukKayit?r.roles[2].huk:'',
            '3. Jüri Muhalefet':r.roles[2].muhKayit?r.roles[2].muh:'',
            'Toplam Hükümet':r.puanH??'','Toplam Muhalefet':r.puanM??'',
            'Hükümet Süre':r.sureH==null?'':sureyiMetneDonustur(r.sureH),
            'Muhalefet Süre':r.sureM==null?'':sureyiMetneDonustur(r.sureM),
            '1. Jüri Adı':r.names[0].name,'2. Jüri Adı':r.names[1].name,'3. Jüri Adı':r.names[2].name,
            'Galip':'','Durum':r.durum
        }));

        const taslakRows=(sonRaporVerisi.taslakAnalizi?.kayitlar||[])
            .filter(x=>aktifMacIdleri.has(x.macId)&&!bitmisMacIdleri.has(x.macId))
            .map(x=>{
                const row={'Maç ID':x.macId,'Okul':x.okul,'Öğrenci':x.ogrenci,
                    'Jüri':x.juri,'Jüri Adı':x.juriAd,'Dolu Kriter':x.dolu};
                krit.forEach((k,i)=>row[(i+1)+'. '+k.t]=Number(x.ayrinti[i]||0));
                row['Eksik Kriterler']=x.eksikKriterler;
                row['Taslak Puanı (Boşlar 0)']=x.toplam;
                row['Durum']='Taslak — resmî sonuca dahil değil';
                return row;
            });

        const wb=XLSX.utils.book_new();
        const sayfaEkle=(ad,satirlar,bilgi)=>{
            const ws=XLSX.utils.json_to_sheet(satirlar.length?satirlar:[{'Bilgi':bilgi}]);
            if(ws['!ref'])ws['!autofilter']={ref:ws['!ref']};
            XLSX.utils.book_append_sheet(wb,ws,ad);
        };
        sayfaEkle('Takim Sonuclari',takimRows,'Kesinleşmemiş maç bulunamadı.');
        sayfaEkle('Puanlar',puanRows,'Aktif maçlara ait öğrenci puanı bulunamadı.');
        sayfaEkle('Juri Durumu',juriRows,'Aktif maçlarda jüri puan kaydı bulunamadı.');
        sayfaEkle('Okul Ozeti',okulRows,'Aktif maçlara ait okul puanı bulunamadı.');
        sayfaEkle('MVP',mvpRows,'Aktif maçlara ait öğrenci puanı bulunamadı.');
        sayfaEkle('Ogrenci Sureleri',sureRows,'Aktif maçlarda öğrenci süre kaydı bulunamadı.');
        sayfaEkle('Sure Toplamlari',sureToplamRows,'Kesinleşmemiş maçlarda süre kaydı bulunamadı.');
        sayfaEkle('Taslak Simulasyonu',taslakRows,'Aktif maçlara ait eksik taslak puan bulunamadı.');

        const tarih=new Date().toISOString().slice(0,10);
        const dosyaAdi=`Munazara_Aktif_Maclar_${kategori}_${tarih}.xlsx`;
        XLSX.writeFile(wb,dosyaAdi);
        showToast(`Excel hazır: ${aktifMacRaporlari.length} açık maç · ${bitmisMacIdleri.size} bitmiş maç dışarıda bırakıldı.`);
    }

    