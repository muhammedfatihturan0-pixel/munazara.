// --- PUANLAMA MODÜLÜ ---
    // Fikstür ve öğrenci kayıtları ayrı Firebase dallarındadır. Maçlar her zaman
    // sabit resmî fikstürden OKUNUR; bu işlem fikstürü veya jüri dağılımını yazmaz.
    let puanlamaYuklemeSurumu = 0;
    let puanlamaKayitliOkullar = {};
    let puanlamaMaclar = new Map();
    let puanlamaFiksturMaclar = [];
    let puanlamaOkulHatasi = '';

    function puanlamaOkulAdlari() {
        return Object.keys(puanlamaKayitliOkullar).sort((a,b)=>a.localeCompare(b,'tr'));
    }

    // Okul adlarındaki biçim ve noktalama farklarına karşı tekil, güvenli eşleme.
    // İsim kökü/benzerlik/fuzzy eşleştirme YOK: birden çok aday varsa işlem durur.
    function guvenliOkulAnahtari(ad){
        return puanMetniNormalize(ad).toLocaleLowerCase('tr-TR')
            .replace(/ı/g,'i').replace(/i\u0307/g,'i')
            .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
            .replace(/[^a-z0-9]/g,'');
    }
    function guvenliKadroKaynagiBul(okullar,mac,taraf,puanlanan=[]){
        const hedef=taraf==='huk'?mac.hukOkul:mac.muhOkul;
        const secili=mac.ogrenciKaynaklari?.[taraf]||'';
        const keys=Object.keys(okullar).filter(k=>Array.isArray(okullar[k])&&okullar[k].length);
        const kapsiyor=k=>(puanlanan||[]).every(ad=>
            okullar[k].some(ogr=>skorEslesmeAnahtari(ogr)===skorEslesmeAnahtari(ad)));
        const adaylar=keys.filter(k=>
            guvenliOkulAnahtari(k)===guvenliOkulAnahtari(hedef) && kapsiyor(k));
        if(secili && keys.includes(secili) && kapsiyor(secili))return secili;
        if(adaylar.length===1)return adaylar[0];
        // Farklı isimli kadroyu sadece BU MAÇTA puanlanan öğrencilerin TAMAMINI
        // kapsayan TEK kayıt olduğunda öner. Çakışmada kendiliğinden seçme.
        if((puanlanan||[]).length>=2){
            const puanUyumlu=keys.filter(k=>kapsiyor(k));
            if(puanUyumlu.length===1)return puanUyumlu[0];
        }
        return '';
    }
    function puanlamaTamOkulEslesmesi(fiksturAdi) {
        const k=guvenliOkulAnahtari(fiksturAdi);
        const aday=puanlamaOkulAdlari().filter(n=>guvenliOkulAnahtari(n)===k);
        return aday.length===1?aday[0]:'';
    }

    function puanlamaRosteriGetir(snap) {
        const map={};
        snap.forEach(o=>{
            const vals=o.val();
            const students=(vals && typeof vals==='object' ? Object.values(vals) : [])
                .filter(x=>typeof x==='string' && x.trim()).map(x=>String(x).trim());
            map[o.key]=students;
        });
        return map;
    }

    function puanlamaDurumYaz(metin,hata=false) {
        const el=document.getElementById('puanlamaVeriDurumu');
        if(el){el.className='puanlama-bilgi'+(hata?' hata':'');el.textContent=metin;}
    }

    function puanlamaManuelOkulSecenekleri() {
        // Öğrenci kaydı olmayan fikstür okulları da görünür kalır. Bu sadece ekranda
        // seçenek oluşturur; Firebase'e okul veya hayalî öğrenci yazılmaz.
        const names=new Set(puanlamaOkulAdlari());
        for(const m of puanlamaMaclar.values()){
            if(m.hukOkul)names.add(m.hukOkul);
            if(m.muhOkul)names.add(m.muhOkul);
        }
        for(const id of ['hukOkul','muhOkul']){
            const select=document.getElementById(id);if(!select)continue;
            const before=id==='hukOkul'?'Hükümet Okul Seçiniz':'Muhalefet Okul Seçiniz';
            select.innerHTML=`<option value="">${before}</option>`+
                [...names].sort((a,b)=>a.localeCompare(b,'tr')).map(n=>`<option value="${htmlEscape(n)}">${htmlEscape(n)}</option>`).join('');
            const val=secimler[id]||'';
            if(val && [...select.options].some(x=>x.value===val))select.value=val;
        }
    }

    async function puanlamaFiksturMaclariniOku() {
        // Puanlama ekranı hiçbir koşulda eksik fikstürü yeniden OLUŞTURMAZ.
        const ortak=await db.ref('fikstur/tekSalon_2026_2027').once('value');
        if(!ortak.exists() || !ortak.val()?.juries || !ortak.val()?.topics)
            throw new Error('Ortak sabit fikstür bulunamadı veya okunamadı. Önce Turnuva Ağacı ekranında mevcut veriyi kontrol edin; sıfırlama yapmayın.');
        let frame=document.getElementById('turnuvaFiksturFrame') || gizliFiksturFrame;
        if(!frame){
            frame=document.createElement('iframe');
            frame.id='fiksturGizliEslesme';
            frame.title='Sabit fikstür karşılaşmaları';
            frame.style.cssText='display:none;';
            document.body.appendChild(frame);
            gizliFiksturFrame=frame;
            frame.srcdoc=base64Utf8Coz(TURNUVA_FIKSTUR_B64);
        }
        for(let i=0;i<100;i++){
            let liste=null;
            try { liste=frame.contentWindow?.fiksturTumMaclariGetir?.(); }catch(_){}
            if(Array.isArray(liste))return liste;
            await new Promise(resolve=>setTimeout(resolve,140));
        }
        throw new Error('Sabit fikstür Firebase’den alınamadı. İnternet bağlantısını ve Turnuva Ağacı ekranındaki Firebase durumunu kontrol edin.');
    }

    function puanlamaGecerliFiksturMaci(m) {
        if(!m || m.isBay || m.isEmpty || m.isPending || !m.team1 || !m.team2 ||
           [m.team1,m.team2].some(x=>fiksturIstisnaNorm(x)==='boş'||fiksturIstisnaNorm(x)==='bay') ||
           !Number.isInteger(Number(m.no)))return false;
        const x=(m.team1+' '+m.team2).toLocaleLowerCase('tr-TR');
        return !/maç galibi|tur galibi|kura beklen|belirlenecek|canlı kura|protokol/.test(x);
    }

    function puanlamaFiksturMacKaydi(m, mevcut={}) {
        const kategori=m.cat==='lise'?'LİSE':'ORTAOKUL';
        const id=macKimligiOlustur(kategori,m.team1,m.team2);
        return {
            ...mevcut,id,kategori,hukOkul:m.team1,muhOkul:m.team2,
            etiket:macEtiketi(m.team1,m.team2),fiksturNo:Number(m.no),
            fiksturTarih:m.dateStr||'',fiksturSaat:m.time||'',
            ogrenciKaynaklari:mevcut.ogrenciKaynaklari||{},
            isPending:!!m.isPending,
            durum:mevcut.durum||'acik'
        };
    }

    // Cihazın yerel tarih/saatine göre mevcut veya sıradaki açık resmî maçı bulur.
    // Tek salon fikstüründe aynı anda iki maç seçmek riskli olduğundan eşit/çakışan
    // başlangıçlarda rastgele seçim yapmaz; ilgili alanı jüriye manuel seçtirir.
    function puanlamaMacSaatAraliginiCoz(m) {
        const tarihKey = raporFiksturTarihAnahtari(m?.fiksturTarih || m?.tarih || '');
        const saatMetni = String(m?.fiksturSaat || m?.time || '');
        const saat = saatMetni.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
        if (!tarihKey || !saat) return null;
        const [y, mo, d] = tarihKey.split('-').map(Number);
        const baslangic = new Date(y, mo - 1, d, Number(saat[1]), Number(saat[2]), 0, 0).getTime();
        const bitis = new Date(y, mo - 1, d, Number(saat[3]), Number(saat[4]), 0, 0).getTime();
        if (!Number.isFinite(baslangic) || !Number.isFinite(bitis) || bitis <= baslangic) return null;
        return { tarihKey, baslangic, bitis };
    }

    function puanlamaYerelBugunKeyi(zamanDamgasi=Date.now()) {
        const n = new Date(zamanDamgasi);
        return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
    }

    async function puanlamaSunucuSaatiniGetir() {
        // Cihaz saati hatalıysa Firebase'in saat farkını kullan; bağlantı yoksa yerel saate dön.
        try {
            const snap = await db.ref('.info/serverTimeOffset').once('value');
            const fark = Number(snap.val());
            if (Number.isFinite(fark)) return Date.now() + fark;
        } catch (err) {
            console.warn('Sunucu saat farkı okunamadı; cihaz saati kullanılacak:', err);
        }
        return Date.now();
    }

    function puanlamaSaatineGoreOtomatikMacBul(simdi=Date.now()) {
        const bugun = puanlamaYerelBugunKeyi(simdi);
        const adaylar = [...puanlamaMaclar.values()]
            .filter(m => m?.fiksturNo && m.kategori === secimler.kategori && !['kapali','iptal'].includes(m.durum))
            .map(m => {
                const aralik = puanlamaMacSaatAraliginiCoz(m);
                return aralik ? { id: m.id || macKimligiOlustur(m.kategori,m.hukOkul,m.muhOkul), m, ...aralik } : null;
            })
            .filter(Boolean);
        if (!adaylar.length) return '';

        const benzersizIlk = liste => {
            if (!liste.length) return '';
            liste.sort((a,b)=>a.baslangic-b.baslangic || a.bitis-b.bitis);
            // Aynı zaman diliminde birden çok aday varsa yanlış maçı otomatik seçme.
            if (liste.length > 1 && liste[0].baslangic === liste[1].baslangic) return '';
            return liste[0].id;
        };
        const aktif = adaylar.filter(a => a.baslangic <= simdi && simdi <= a.bitis);
        if (aktif.length) return benzersizIlk(aktif);

        const bugununSiradaki = adaylar.filter(a => a.tarihKey === bugun && a.baslangic > simdi);
        const siradakiBugunId = benzersizIlk(bugununSiradaki);
        if (siradakiBugunId) return siradakiBugunId;

        // Bugünkü açık maçların saati geçmişse önce bugünün son açık maçını seç.
        const bugununGecmisi = adaylar.filter(a => a.tarihKey === bugun && a.bitis < simdi)
            .sort((a,b)=>b.baslangic-a.baslangic);
        if (bugununGecmisi.length) {
            if (bugununGecmisi.length > 1 && bugununGecmisi[0].baslangic === bugununGecmisi[1].baslangic) return '';
            return bugununGecmisi[0].id;
        }

        const gelecektekiler = adaylar.filter(a => a.baslangic > simdi).sort((a,b)=>a.baslangic-b.baslangic);
        const siradakiGenelId = benzersizIlk(gelecektekiler);
        if (siradakiGenelId) return siradakiGenelId;

        // Takvimde geriye dönük açık kayıt kaldıysa en sonuncuyu seç; kapalı maçlar aday değildir.
        const gecmis = adaylar.filter(a => a.bitis < simdi).sort((a,b)=>b.baslangic-a.baslangic);
        if (!gecmis.length) return '';
        if (gecmis.length > 1 && gecmis[0].baslangic === gecmis[1].baslangic) return '';
        return gecmis[0].id;
    }

    async function puanlamaVerileriniYukle(korunacakMacId = '') {
        const surum=puanlamaYuklemeSurumu,kat=secimler.kategori;
        const [oRes,mRes]=await Promise.allSettled([
            db.ref('okullar/'+kat).once('value'),
            db.ref('maclar/'+kat).once('value')
        ]);
        if(surum!==puanlamaYuklemeSurumu || !document.getElementById('aktifMac'))return;
        puanlamaOkulHatasi='';
        puanlamaKayitliOkullar={};
        if(oRes.status==='fulfilled')puanlamaKayitliOkullar=puanlamaRosteriGetir(oRes.value);
        else puanlamaOkulHatasi=String(oRes.reason?.message||oRes.reason||'Öğrenci kayıtları okunamadı.');
        const varOlanMaclar={};
        if(mRes.status==='fulfilled')mRes.value.forEach(c=>{varOlanMaclar[c.key]=c.val();});
        puanlamaDurumYaz(puanlamaOkulHatasi
            ? 'Öğrenci kayıtları okunamadı: '+puanlamaOkulHatasi+' · Fikstür yükleniyor…'
            : `Öğrenci kayıtları: ${puanlamaOkulAdlari().length} okul, ${Object.values(puanlamaKayitliOkullar).reduce((n,a)=>n+a.length,0)} öğrenci. Sabit fikstür yükleniyor…`,!!puanlamaOkulHatasi);
        let fixture=[];let fixtureErr='';
        try{fixture=await puanlamaFiksturMaclariniOku();}catch(err){fixtureErr=String(err?.message||err);}
        if(surum!==puanlamaYuklemeSurumu || !document.getElementById('aktifMac'))return;
        const cat=kat==='LİSE'?'lise':'ortaokul';
        puanlamaFiksturMaclar=fixture.filter(m=>m.cat===cat && puanlamaGecerliFiksturMaci(m));
        puanlamaMaclar=new Map();
        for(const m of puanlamaFiksturMaclar){
            const id=macKimligiOlustur(kat,m.team1,m.team2);
            const entry=puanlamaFiksturMacKaydi(m,varOlanMaclar[id]||{});
            puanlamaMaclar.set(id,entry);
        }
        // Eskiden puan girilmiş ama henüz eşleşmeye taşınmamış maçları sakla.
        for(const [key,m] of Object.entries(varOlanMaclar)){
            if(!m?.hukOkul||!m?.muhOkul||puanlamaMaclar.has(key))continue;
            puanlamaMaclar.set(key,{...m,id:key});
        }
        puanlamaManuelOkulSecenekleri();
        const select=document.getElementById('aktifMac');
        if(!select)return;
        const donenler=puanlamaFiksturMaclar.length;
        const ekMaclar=[...puanlamaMaclar.values()].filter(m=>!m.fiksturNo);
        select.innerHTML='<option value="">Maç seçiniz — sabit fikstürden yüklenir</option>'+
            puanlamaFiksturMaclar.map(m=>{
                const id=macKimligiOlustur(kat,m.team1,m.team2);
                const md=puanlamaMaclar.get(id)?.durum;
                const durum=md==='kapali'?' [TAMAMLANDI]':md==='iptal'?' [İPTAL]':'';
                const disabled=md==='iptal'?' disabled':'';
                return `<option value="${htmlEscape(id)}"${disabled}>#${m.no} · ${htmlEscape(m.dateStr||'Tarih belirlenecek')} · ${htmlEscape(m.time||'')} · ${htmlEscape(m.team1)} — ${htmlEscape(m.team2)}${durum}</option>`;
            }).join('')+
            (ekMaclar.length?'<optgroup label="Eski / manuel puanlama kayıtları">'+ekMaclar.map(m=>`<option value="${htmlEscape(m.id)}">${htmlEscape(m.etiket||macEtiketi(m.hukOkul,m.muhOkul))}</option>`).join('')+'</optgroup>':'');
        const oncekiMac=secimler.macId;
        const otomatikSimdi=await puanlamaSunucuSaatiniGetir();
        if(surum!==puanlamaYuklemeSurumu || document.getElementById('aktifMac')!==select)return;
        const otomatikMacId=puanlamaSaatineGoreOtomatikMacBul(otomatikSimdi);
        const otomatikMacSecenegi=otomatikMacId ? [...select.options].find(x=>x.value===otomatikMacId && !x.disabled) : null;
        const korunacakMacSecenegi=korunacakMacId ? [...select.options].find(x=>x.value===korunacakMacId && !x.disabled) : null;
        const oncekiMacSecenegi=oncekiMac ? [...select.options].find(x=>x.value===oncekiMac && !x.disabled) : null;
        if(korunacakMacSecenegi){
            // Puan gönderiminden dönüşte aynı maçta kal; yalnızca öğrenci seçimi yeniden yapılır.
            select.value=korunacakMacId;
            await merkeziMacSecildi(true);
        }else if(otomatikMacSecenegi){
            // Yeni girişlerde mevcut davranış: cihaz/sunucu saatine uygun maçı otomatik seç.
            select.value=otomatikMacId;
            await merkeziMacSecildi(true);
        }else if(oncekiMacSecenegi){
            const oncekiKayit=puanlamaMaclar.get(oncekiMac);
            const oncekiZaman=puanlamaMacSaatAraliginiCoz(oncekiKayit);
            // Otomatik eşleşme çözülemezse yalnızca manuel kayıtları veya bugüne ait
            // açık bir maçı koru; önceki günün maçını fark ettirmeden seçili bırakma.
            if(!oncekiKayit?.fiksturNo || (oncekiZaman?.tarihKey===puanlamaYerelBugunKeyi() && !['kapali','iptal'].includes(oncekiKayit?.durum))){
                select.value=oncekiMac;
                await merkeziMacSecildi(true);
            }else{
                secimler.macId='';secimler.ogr='';secimler.okul='';
                secimler.hukOkul='';secimler.muhOkul='';secimleriKaydet();
                puanlamaManuelOkulSecenekleri();
                puanlamaKaynakPaneliniGuncelle();
                void juriPaneliniGuncelle(null);
            }
        }else{
            secimler.macId='';secimler.ogr='';secimler.okul='';
            secimler.hukOkul='';secimler.muhOkul='';secimleriKaydet();
            puanlamaManuelOkulSecenekleri();
            puanlamaKaynakPaneliniGuncelle();
            void juriPaneliniGuncelle(null);
        }
        const stuCount=Object.values(puanlamaKayitliOkullar).reduce((n,a)=>n+a.length,0);
        const durum=`Sabit fikstür: ${donenler} gerçek ${kat.toLocaleLowerCase('tr-TR')} maçı · Öğrenci listesi: ${puanlamaOkulAdlari().length} okul / ${stuCount} öğrenci.`;
        let ek='';
        if(puanlamaOkulHatasi)ek+=' Öğrenci kayıtları okunamadı: '+puanlamaOkulHatasi+'.';
        else if(!stuCount)ek+=' Öğrenci kayıtları bu kategoride bulunamadı; Okullar ve Öğrenciler modülünden kontrol edin.';
        if(fixtureErr)ek+=' Fikstür hatası: '+fixtureErr;
        if(mRes.status==='rejected')ek+=' Eski maç kayıtları okunamadı: '+String(mRes.reason?.message||mRes.reason);
        puanlamaDurumYaz(durum+ek,!!(puanlamaOkulHatasi||fixtureErr));
        if(secimler.taraf)ogrencileriYukle();
        canliJuriTakibiBaslat();
    }

    function puanlamaVerileriniYenile() {
        puanlamaYuklemeSurumu++;
        puanlamaDurumYaz('Firebase’deki maç ve öğrenci kayıtları yeniden kontrol ediliyor…');
        void puanlamaVerileriniYukle();
    }

    function renderPuanlamaSecim(korunacakMacId = '') {
        dinleyicileriTemizle();
        puanlamaYuklemeSurumu++;
        verilenPuanlar = {};
        aktifPuanTaslak=null;
        puanlamaKayitliOkullar={};
        puanlamaMaclar=new Map();
        const oturum = juriOturumuGetir();
        if (oturum) {
            secimler.juri = oturum.juri;
            secimler.juriAd = oturum.ad;
        }else{secimler.juri='';secimler.juriAd='';}
        secimleriKaydet();
        const juriHtml = `
            <div id="juriOturumPanel" class="kriter-card" style="border-color:#365174;">
                <div style="font-size:13px;color:#cbd5e1;">Maç seçildiğinde yalnızca o günün ve kategorinin <b>3 asıl jüri adı</b> listelenir. Yedek jüri bu seçim listesinde gösterilmez.</div>
            </div>`;
        document.getElementById('app').innerHTML = `
            <div class="card juri-selection-card" style="max-width:1080px;">
                <header class="juri-selection-header"><div><span class="juri-page-eyebrow">JÜRİ ÇALIŞMA ALANI</span><h2>Jüri Puanlama</h2><p>Önce karşılaşmayı seçin, ardından taraf ve öğrenciyi belirleyin.</p></div><span class="juri-header-mark">13 kriter · otomatik taslak</span></header>
                <div class="btn-grid" style="grid-template-columns:1fr 1fr;gap:8px;">
                    <button class="btn" style="background:#1d4ed8; margin:0;" onclick="renderSureAnaEkran()">⏱ Konuşma Süreleri (Şifresiz)</button>
                    <button class="btn" style="margin:0;" onclick="anaMenu()">← Ana Ekran</button>
                </div>
                <div class="puan-guvence-juri-actions"><button type="button" onclick="juriPuanGecmisiniAc()">📚 Gönderdiğim puanlar</button><button type="button" onclick="puanKuyrukDetayiniAc()">📤 Bekleyen puanlar</button></div>
                ${juriHtml}
                <div id="puanFirebaseDurumu" class="puanlama-bilgi hata" role="alert" style="display:none;"></div>
                <section class="juri-step-block juri-step-category">
                    <div class="juri-step-heading"><span>01</span><div><b>Kategori</b><small>Öğrenci düzeyini seçin</small></div></div>
                    <div class="btn-grid juri-category-grid" style="grid-template-columns:1fr 1fr;margin-bottom:0;">
                        <button class="btn kat-btn ${secimler.kategori==='ORTAOKUL'?'btn-active':''}" onclick="katSec(this, 'ORTAOKUL', 'puanlama')">ORTAOKUL</button>
                        <button class="btn kat-btn ${secimler.kategori==='LİSE'?'btn-active':''}" onclick="katSec(this, 'LİSE', 'puanlama')">LİSE</button>
                    </div>
                </section>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <div id="puanlamaVeriDurumu" class="puanlama-bilgi" style="flex:1;">Sabit fikstür ve öğrenci kayıtları yükleniyor…</div>
                    <button class="btn" style="width:auto;padding:10px 12px;margin:0;" onclick="puanlamaVerileriniYenile()">↻ Yenile</button>
                </div>
                <section class="juri-step-block">
                    <div class="juri-step-heading"><span>02</span><div><b>Karşılaşma</b><small>Bugünkü aktif maç otomatik önerilir; gerekirse değiştirin</small></div></div>
                    <label for="aktifMac" class="puanlama-etiket">Maç</label>
                    <select id="aktifMac" class="juri-large-select" onchange="merkeziMacSecildi()"><option value="">Fikstür maçları yükleniyor…</option></select>
                    <div id="seciliMacBilgisi" class="juri-match-summary">Maç seçildiğinde hükümet ve muhalefet okulları otomatik belirlenecek.</div>
                </section>
                <details class="puanlama-manuel"><summary>Gerektiğinde okulları manuel seç</summary>
                    <select id="hukOkul" onchange="macOkulDegisti('hukOkul')"><option value="">Hükümet Okul Seçiniz</option></select>
                    <select id="muhOkul" onchange="macOkulDegisti('muhOkul')"><option value="">Muhalefet Okul Seçiniz</option></select>
                </details>
                <div id="puanlamaKaynakPanel"></div>
                <section class="juri-step-block">
                    <div class="juri-step-heading"><span>03</span><div><b>Değerlendireceğiniz taraf</b><small>Hükümet veya muhalefet okulunu seçin</small></div></div>
                    <div class="btn-grid juri-side-grid" style="grid-template-columns:1fr 1fr;margin:0;">
                        <button class="btn taraf-btn ${secimler.taraf==='HÜKÜMET'?'btn-active':''}" style="border-left:4px solid var(--hukumet);" onclick="tekSecim(this,'taraf','taraf-btn')"><span>HÜKÜMET</span><small id="juriHukOkulEtiketi">Hükümet okulu</small></button>
                        <button class="btn taraf-btn ${secimler.taraf==='MUHALEFET'?'btn-active':''}" style="border-left:4px solid var(--muhalefet);" onclick="tekSecim(this,'taraf','taraf-btn')"><span>MUHALEFET</span><small id="juriMuhOkulEtiketi">Muhalefet okulu</small></button>
                    </div>
                </section>
                <section class="juri-step-block juri-student-step">
                    <div class="juri-step-heading"><span>04</span><div><b>Öğrenci</b><small>Listeden puanlayacağınız konuşmacıyı seçin</small></div></div>
                    <div class="btn-grid juri-student-grid" id="ogrenciButonAlani">
                        <div class="juri-selection-empty">Önce maç ve taraf seçiniz.</div>
                    </div>
                </section>
                <div id="canliJuriDurumu" class="kriter-card juri-live-status" style="margin-top:15px;">Maç ve öğrenci seçildiğinde jüri durumu burada görünecek.</div>
                <button class="btn juri-start-scoring-button" onclick="puanlamaSayfasinaGec()" ${oturum?'':'disabled'}>Seçilen öğrenciyi puanla <span>→</span></button>
                <details class="juri-advanced-settings">
                    <summary>Sorun giderme ve gelişmiş işlemler</summary>
                    <p>Ortak süreyi sıfırlamak aynı öğrenci için bütün jüri cihazlarındaki 6 dakikalık sayacı yeniden başlatır. Yalnızca gerçekten gerekli olduğunda kullanın.</p>
                    <button class="btn" style="background:#92400e;border-color:#b45309;" onclick="juriSurePenceresiniSifirla('juri_secim_ekrani')">↻ Ortak süreyi sıfırla</button>
                </details>
                <button class="btn juri-back-button" onclick="anaMenu()">← Ana Menü</button>
            </div>`;
        puanFirebaseDurumuGoster();
        void juriPaneliniGuncelle();
        void puanlamaVerileriniYukle(korunacakMacId);
    }

    function puanlamaKaynakAdi(m,taraf) {
        const v=taraf==='HÜKÜMET'?'huk':'muh';
        const raw=v==='huk'?m?.hukOkul:m?.muhOkul;
        const kayit=m?.ogrenciKaynaklari?.[v];
        if(kayit && Object.hasOwn(puanlamaKayitliOkullar,kayit))return kayit;
        return puanlamaTamOkulEslesmesi(raw);
    }

    function puanlamaKaynakPaneliniGuncelle() {
        const container=document.getElementById('puanlamaKaynakPanel');
        const bilgi=document.getElementById('seciliMacBilgisi');
        if(!container)return;
        const m=puanlamaMaclar.get(secimler.macId);
        if(!m){container.innerHTML='';if(bilgi)bilgi.textContent='Maç seçildiğinde okullar otomatik belirlenecek.';return;}
        if(bilgi)bilgi.textContent=`${m.fiksturNo?'#'+m.fiksturNo+' · ':''}${m.fiksturTarih||''} ${m.fiksturSaat||''} · HÜKÜMET: ${m.hukOkul} / MUHALEFET: ${m.muhOkul}`;
        const hukTag=document.getElementById('juriHukOkulEtiketi');
        const muhTag=document.getElementById('juriMuhOkulEtiketi');
        if(hukTag)hukTag.textContent=m.hukOkul||'Hükümet okulu';
        if(muhTag)muhTag.textContent=m.muhOkul||'Muhalefet okulu';
        const huk=puanlamaKaynakAdi(m,'HÜKÜMET');
        const muh=puanlamaKaynakAdi(m,'MUHALEFET');
        if(!puanlamaOkulAdlari().length){
            container.innerHTML='<div class="puanlama-bilgi hata">Bu kategori için kayıtlı öğrenci listesi bulunamadı veya okunamadı. Okullar ve Öğrenciler bölümündeki kayıtları kontrol edin. Maçlar ve fikstür silinmedi.</div>';
            return;
        }
        // Eşleşme doğru ve her iki okulun listesi doluysa hiçbir onay veya düzeltme isteme.
        if(huk && muh && puanlamaKayitliOkullar[huk]?.length && puanlamaKayitliOkullar[muh]?.length){
            container.innerHTML=`<div class="puanlama-bilgi">Öğrenci listeleri bulundu: <b>${htmlEscape(m.hukOkul)}</b> (${puanlamaKayitliOkullar[huk].length} öğrenci) · <b>${htmlEscape(m.muhOkul)}</b> (${puanlamaKayitliOkullar[muh].length} öğrenci).</div>`;
            return;
        }
        // Jüri, resmî maçın taraflarını değiştirmez. Eşleştirme yalnızca yönetici alanındadır.
        const missing=[];
        if(!huk || !(puanlamaKayitliOkullar[huk]||[]).length)missing.push('Hükümet: '+m.hukOkul);
        if(!muh || !(puanlamaKayitliOkullar[muh]||[]).length)missing.push('Muhalefet: '+m.muhOkul);
        container.innerHTML=`<div class="puanlama-bilgi hata">
            <b>Öğrenci listesi kontrolü gerekli.</b> Resmî maç eşleşmesi değiştirilmemiştir.
            <div style="margin-top:7px">Öğrenci listesi bulunamayan taraf(lar): ${htmlEscape(missing.join(' · '))}.</div>
            <div style="margin-top:7px">Eksik öğrencileri Yönetici Modülü → Okullar ve Öğrenciler'den kaydedin. Okulun fikstürdeki adı ile kayıtlı öğrenci listesi adı farklıysa Yönetici Modülü'ndeki <b>Öğrenci Listesi Eşleştirmeleri</b> alanını kullanın.</div>
        </div>`;
    }

    async function puanlamaKaynaklariniKaydet() {
        const m=puanlamaMaclar.get(secimler.macId);
        if(!m)return alert('Önce sabit fikstürden maç seçin.');
        if(!adminYetkiliMi() && !adminSifreDogrula('Öğrenci listesi eşleştirmek için yönetici şifresini giriniz:'))return;
        const huk=document.getElementById('puanlamaKaynak_huk')?.value||'';
        const muh=document.getElementById('puanlamaKaynak_muh')?.value||'';
        if(!huk||!muh || !puanlamaKayitliOkullar[huk]?.length || !puanlamaKayitliOkullar[muh]?.length)
            return alert('Her iki takım için de öğrenci içeren kayıtlı okul seçilmelidir.');
        if(huk===muh)return alert('İki farklı takım aynı öğrenci listesine bağlanamaz.');
        const current=m.ogrenciKaynaklari||{};
        try{
            const snap=await db.ref(`puanlar/${secimler.kategori}`).once('value');
            let hasScore=false;
            snap.forEach(c=>{if(kayitMacId(c.val())===m.id)hasScore=true;});
            if(hasScore && (current.huk!==huk || current.muh!==muh))
                return alert('Bu maçta puan kaydı bulunduğundan öğrenci kaynağı değiştirilemez. Yetkili olarak önce puanları kontrol edin.');
            const result=await db.ref(`maclar/${secimler.kategori}/${m.id}`).transaction(cur=>{
                if (['kapali','iptal'].includes(cur?.durum))return;
                if(cur?.hukOkul && (cur.hukOkul!==m.hukOkul || cur.muhOkul!==m.muhOkul))return;
                // Başka cihazda eşzamanlı değiştirildiyse değişikliği sessizce ezme.
                if((cur?.ogrenciKaynaklari?.huk||'')!==(current.huk||'') ||
                   (cur?.ogrenciKaynaklari?.muh||'')!==(current.muh||''))return;
                return {...cur,id:m.id,kategori:secimler.kategori,hukOkul:m.hukOkul,muhOkul:m.muhOkul,
                    etiket:m.etiket,durum:cur?.durum||'acik',fiksturNo:m.fiksturNo||null,
                    ogrenciKaynaklari:{huk,muh},createdAt:cur?.createdAt||Date.now(),updatedAt:Date.now()};
            },undefined,false);
            if(!result.committed)return alert('Maç kapanmış veya bilgiler değişmiş. Eşleştirme kaydedilemedi.');
            m.ogrenciKaynaklari={huk,muh};
            secimler.ogr='';secimler.okul='';secimleriKaydet();
            puanlamaKaynakPaneliniGuncelle();
            ogrencileriYukle();
            alert('Öğrenci listeleri eşleştirildi. Fikstür ve öğretmen görevleri değişmedi.');
        }catch(err){alert('Öğrenci eşleştirmesi kaydedilemedi: '+String(err?.message||err));}
    }

    // Jüri seçimi, seçili maçın günü ve kategorisindeki üç asıl jüri üzerinden yapılır.
    // Cihaz kilidi başka güne aitse rolü yeni güne otomatik taşımayız; jüri kilidi kaldırıp
    // o günün listesinden kendi adını seçmelidir. Yedek jüri puanlama listesine eklenmez.
    let juriPanelYuklemeSurumu = 0;
    function juriSecimBaglami(mac) {
        if (!mac) return null;
        const tarih = mac.fiksturTarih || mac.tarih || '';
        const gunKey = raporFiksturTarihAnahtari(tarih);
        if (!gunKey) return null;
        return { gunKey, gunLabel: tarih || gunKey, kategori: secimler.kategori === 'LİSE' ? 'lise' : 'ortaokul' };
    }
    function juriOturumuSeciliMacaUygun(oturum, mac) {
        const b = juriSecimBaglami(mac);
        return !!(oturum && b && oturum.gunKey === b.gunKey && oturum.kategori === b.kategori &&
            ['1. Jüri','2. Jüri','3. Jüri'].includes(oturum.juri));
    }
    function juriPanelMetin(panel, metin, hata=false) {
        const d = document.createElement('div');
        d.style.cssText = `font-size:13px;line-height:1.55;color:${hata?'#fed7aa':'#cbd5e1'};`;
        d.textContent = metin;
        panel.appendChild(d);
    }
    async function juriPaneliniGuncelle(mac=null) {
        const panel = document.getElementById('juriOturumPanel');
        if (!panel) return;
        const yuklemeSurumu = ++juriPanelYuklemeSurumu;
        const aktifMac = mac || puanlamaMaclar.get(secimler.macId) || null;
        const baglam = juriSecimBaglami(aktifMac);
        const oturum = juriOturumuGetir();
        panel.replaceChildren();

        if (oturum) {
            const ust = document.createElement('div');
            ust.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;';
            const metin = document.createElement('div');
            const label = document.createElement('div');
            label.style.cssText = 'font-size:11px;color:var(--text-muted);text-transform:uppercase;';
            label.textContent = 'Bu cihazın jüri kilidi';
            const ad = document.createElement('b');
            ad.style.color = '#34d399';
            ad.textContent = oturum.yedekMi
                ? `Yedek jüri · ${oturum.juri} yerine · ${oturum.ad}`
                : `${oturum.juri} · ${oturum.ad}`;
            metin.append(label, ad);
            const kontroller = document.createElement('div');
            kontroller.style.cssText = 'display:flex;gap:7px;flex-wrap:wrap;align-items:center;';
            const yedekBtn = document.createElement('button');
            yedekBtn.className = 'btn';
            yedekBtn.style.cssText = 'width:auto;padding:8px 12px;margin:0;background:#92400e;border-color:#b45309;';
            yedekBtn.textContent = oturum.yedekMi ? 'Yedek jüri atamasını değiştir' : 'Yedek jüriyle değiştir';
            yedekBtn.onclick = () => { void yedekJuriDegisimPaneliniAc(); };
            const kilit = document.createElement('button');
            kilit.className = 'btn';
            kilit.style.cssText = 'width:auto;padding:8px 12px;margin:0;background:#475569;';
            kilit.textContent = 'Jüri Kilidini Kaldır 🔒';
            kilit.onclick = juriOturumunuSifirla;
            kontroller.append(yedekBtn, kilit);
            ust.append(metin, kontroller);
            panel.appendChild(ust);
            const uyumlu = juriOturumuSeciliMacaUygun(oturum, aktifMac);
            if (baglam && !uyumlu) {
                juriPanelMetin(panel, `Bu kilit ${oturum.gunLabel || oturum.gunKey || 'önceki bir oturum'} için kayıtlı. Seçili maç ${baglam.gunLabel} · ${baglam.kategori === 'lise' ? 'Lise' : 'Ortaokul'}. Bugünün jüri listesine geçmek için kilidi kaldırıp kendi adınızı seçin. Puanlama bu kilitle açılamaz.`, true);
            } else if (uyumlu) {
                juriPanelMetin(panel, `${baglam.gunLabel} · ${baglam.kategori === 'lise' ? 'Lise' : 'Ortaokul'} oturumu. Yedek jüri yalnızca değişim düğmesiyle, seçilen jüri koltuğunun yerine atanır.`);
            } else {
                juriPanelMetin(panel, 'Maç seçildiğinde bu kilidin o gün ve kategoriye uygunluğu kontrol edilir. Farklı bir jüri kullanacaksa kilidi kaldırın.');
            }
            return;
        }
        if (!baglam) {
            juriPanelMetin(panel, 'Önce tarihi belli bir maç seçin. Ardından yalnızca o günün 3 asıl jüri adı görüntülenir; yedek jüri listelenmez.');
            return;
        }
        const baslik = document.createElement('div');
        baslik.style.cssText = 'font-size:13px;font-weight:750;margin-bottom:8px;color:#f8fafc;';
        baslik.textContent = `${baglam.gunLabel} · ${baglam.kategori === 'lise' ? 'Lise' : 'Ortaokul'} — kendi adınızı seçin`;
        panel.appendChild(baslik);
        const aciklama = document.createElement('div');
        aciklama.style.cssText = 'font-size:11px;color:var(--text-muted);margin-bottom:10px;';
        aciklama.textContent = 'İlk ekranda yalnızca 1., 2. ve 3. asıl jüri listelenir. Yedek jüri görünmez; gerekirse aşağıdaki düğmeyle açılır.';
        panel.appendChild(aciklama);
        try {
            const snap = await db.ref(`fikstur/tekSalon_2026_2027/juries/${baglam.gunKey}/${baglam.kategori}`).once('value');
            if (yuklemeSurumu !== juriPanelYuklemeSurumu || !document.getElementById('juriOturumPanel')) return;
            const roster = snap.val() || {};
            const roller = [
                ['1. Jüri','asil1','1. Asıl jüri'],
                ['2. Jüri','asil2','2. Asıl jüri'],
                ['3. Jüri','asil3','3. Asıl jüri']
            ];
            const grid = document.createElement('div');
            grid.className = 'btn-grid';
            grid.style.cssText = 'grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0;';
            let sayi = 0;
            for (const [rol, anahtar, rolAd] of roller) {
                const kisi = roster[anahtar] || {};
                const isim = puanMetniNormalize(kisi.name || '');
                if (!isim || /^(protokol|belirlenecek|[-—]+)$/i.test(isim)) continue;
                const btn = document.createElement('button');
                btn.className = 'btn';
                btn.style.cssText = 'margin:0;min-width:0;white-space:normal;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;min-height:82px;';
                const rolSpan = document.createElement('span');
                rolSpan.style.cssText = 'font-size:11px;color:#93c5fd;';
                rolSpan.textContent = rolAd;
                const isimSpan = document.createElement('strong');
                isimSpan.style.cssText = 'font-size:13px;overflow-wrap:anywhere;';
                isimSpan.textContent = isim;
                btn.append(rolSpan, isimSpan);
                if (kisi.school && kisi.school !== '-') {
                    const okul = document.createElement('span');
                    okul.style.cssText = 'font-size:10px;color:var(--text-muted);';
                    okul.textContent = kisi.school;
                    btn.appendChild(okul);
                }
                btn.onclick = () => { void juriOturumuKilitle(rol, isim); };
                grid.appendChild(btn);
                sayi++;
            }
            if (!sayi) {
                juriPanelMetin(panel, 'Bu gün ve kategori için üç asıl jüri adı okunamadı veya görevlendirmeler henüz kesinleşmemiş. Yedek jüri otomatik olarak kullanılmadı.', true);
            } else {
                panel.appendChild(grid);
            }
            const yedekBtn = document.createElement('button');
            yedekBtn.className = 'btn';
            yedekBtn.style.cssText = 'margin:12px 0 0;background:#92400e;border-color:#b45309;';
            yedekBtn.textContent = '↔ Yedek jüriyle değiştir';
            yedekBtn.onclick = () => { void yedekJuriDegisimPaneliniAc(); };
            panel.appendChild(yedekBtn);
        } catch (err) {
            if (yuklemeSurumu !== juriPanelYuklemeSurumu) return;
            juriPanelMetin(panel, 'Günün jüri listesi yüklenemedi. İnternet bağlantısını kontrol edip maç listesini yenileyin.', true);
        }
    }

    async function merkeziMacSecildi(yuklemeden=false) {
        const el=document.getElementById('aktifMac');const id=el?.value||'';
        const m=puanlamaMaclar.get(id);
        if(!m){
            secimler.macId='';secimler.hukOkul='';secimler.muhOkul='';secimler.ogr='';secimler.okul='';
            secimleriKaydet();puanlamaManuelOkulSecenekleri();
            puanlamaKaynakPaneliniGuncelle();
            void juriPaneliniGuncelle(null);
            ogrencileriYukle();canliJuriTakibiBaslat();return;
        }
        if(m.durum==='iptal')return alert('Bu maç yönetici tarafından iptal edilmiştir. Jüri puanlamasına açılamaz.');
        const aktif=document.getElementById('aktifMac');
        if(!aktif||aktif!==el||aktif.value!==id)return; // Bekleme sırasında ekran/maç değiştiyse eski yanıtı uygulama.
        const degisti=secimler.macId!==id || secimler.hukOkul!==m.hukOkul || secimler.muhOkul!==m.muhOkul;
        secimler.macId=id;secimler.hukOkul=m.hukOkul;secimler.muhOkul=m.muhOkul;
        if(degisti){secimler.ogr='';secimler.okul='';}
        secimleriKaydet();
        puanlamaManuelOkulSecenekleri();
        puanlamaKaynakPaneliniGuncelle();
        void juriPaneliniGuncelle(m);
        if(secimler.taraf)ogrencileriYukle();
        else {const box=document.getElementById('ogrenciButonAlani');if(box)box.textContent='Hükümet veya muhalefet tarafını seçin.';}
        canliJuriTakibiBaslat();
    }

    function macOkulDegisti(tip) {
        secimler[tip]=document.getElementById(tip)?.value||'';
        secimler.macId='';secimler.ogr='';secimler.okul='';
        const sel=document.getElementById('aktifMac');if(sel)sel.value='';
        secimleriKaydet();
        puanlamaKaynakPaneliniGuncelle();
        if(secimler.taraf)ogrencileriYukle();
        canliJuriTakibiBaslat();
    }

    function katSec(btn,kategori,modul) {
        secimler.kategori=kategori;
        secimler.hukOkul='';secimler.muhOkul='';secimler.taraf='';
        secimler.ogr='';secimler.okul='';secimler.macId='';
        const oturum=juriOturumuGetir();
        if(oturum){secimler.juri=oturum.juri;secimler.juriAd=oturum.ad;}
        secimleriKaydet();
        if(modul==='puanlama')renderPuanlamaSecim();
        if(modul==='ogrenci')renderOgrenci();
        if(modul==='turnuva')renderTurnuva();
        if(modul==='canli')renderYoneticiCanliPanel();
        if(modul==='sure')renderSureAnaEkran();
        if(modul==='rapor')showReport();
    }

    async function ogrencileriYukle() {
        const alan=document.getElementById('ogrenciButonAlani');
        if(!alan)return;
        if(!secimler.taraf){alan.textContent='Önce maç ve taraf seçiniz.';return;}
        const okul=secimler.taraf==='HÜKÜMET'?secimler.hukOkul:secimler.muhOkul;
        const m=puanlamaMaclar.get(secimler.macId);
        const kaynak=m ? puanlamaKaynakAdi(m,secimler.taraf) : puanlamaTamOkulEslesmesi(okul);
        secimler.okul=okul||'';
        if(!okul)secimler.ogr='';
        secimleriKaydet();
        if(!okul){alan.textContent='Maç ve takım seçilmedi.';return;}
        if(puanlamaOkulHatasi){alan.textContent='Öğrenci kayıtları okunamadı: '+puanlamaOkulHatasi;return;}
        const liste=puanlamaKayitliOkullar[kaynak]||[];
        if(!liste.length){
            alan.innerHTML=`<div class="puanlama-bilgi hata" style="grid-column:span 2;">${htmlEscape(okul)} için kayıtlı öğrenci bulunamadı. Kayıtlı resmî ad farklıysa yukarıdaki eşleştirmeyi kullanın; hiç öğrenci yüklenmemişse Okullar ve Öğrenciler modülünü açın.</div>`;
            secimler.ogr='';secimleriKaydet();canliJuriTakibiBaslat();return;
        }
        alan.innerHTML='';
        liste.forEach((ad,i)=>{
            const rol=i<3?`${i+1}. Konuşmacı`:'Grup Sözcüsü';
            const btnText=`${ad} (${rol})`;
            const btn=document.createElement('button');
            btn.className='btn ogr-btn'+(secimler.ogr===btnText?' btn-active':'');
            btn.textContent=btnText;
            btn.onclick=()=>tekSecim(btn,'ogr','ogr-btn');
            alan.appendChild(btn);
        });
        if(!liste.some((ad,i)=>`${ad} (${i<3?i+1+'. Konuşmacı':'Grup Sözcüsü'})`===secimler.ogr)){
            secimler.ogr='';secimleriKaydet();
        }
        canliJuriTakibiBaslat();
    }

    function tekSecim(element, tip, sinif) {
        document.querySelectorAll('.' + sinif).forEach(b => b.classList.remove('btn-active'));
        element.classList.add('btn-active');
        secimler[tip] = element.innerText;
        if(tip === 'taraf') {
            secimler.ogr = '';
            ogrencileriYukle();
        }
        secimleriKaydet();
        canliJuriTakibiBaslat();
    }

    function mevcutMacBilgisi() {
        const huk = document.getElementById('hukOkul')?.value || secimler.hukOkul;
        const muh = document.getElementById('muhOkul')?.value || secimler.muhOkul;
        if (!huk || !muh) return null;
        const id = secimler.macId || macKimligiOlustur(secimler.kategori, huk, muh);
        return { id, hukOkul:huk, muhOkul:muh, etiket:macEtiketi(huk,muh) };
    }

    function canliJuriTakibiBaslat() {
        if (aktifJuriListenerRef) { aktifJuriListenerRef.off(); aktifJuriListenerRef = null; }
        if (aktifJuriMacListenerRef) { aktifJuriMacListenerRef.off(); aktifJuriMacListenerRef = null; }
        const box = document.getElementById('canliJuriDurumu');
        if (!box) return;
        const mac = mevcutMacBilgisi();
        if (!mac) { box.innerHTML = 'Canlı jüri durumu için iki okulu seçiniz.'; return; }
        let sonKayitlar = [];
        let sonMac = {durum:'acik'};
        const render = () => {
            const macKayitlari = sonKayitlar.filter(v => kayitMacId(v) === mac.id);
            const gruplar = new Map();
            macKayitlari.forEach(v => {
                const k = ogrenciGrupKimligi(v);
                if (!gruplar.has(k)) gruplar.set(k, new Set());
                if (v.secim?.juri) gruplar.get(k).add(v.secim.juri);
            });
            const tam = [...gruplar.values()].filter(s=>BEKLENEN_JURILER.every(j=>s.has(j))).length;
            let ogrHtml = '<span style="color:var(--text-muted);">Öğrenci seçilmedi.</span>';
            if (secimler.ogr && secimler.okul) {
                const ogrKisa = secimler.ogr.split(' (')[0];
                const key = [mac.id, secimler.okul, ogrKisa].map(puanMetniNormalize).join('|');
                const juriler = gruplar.get(key) || new Set();
                const eksik = BEKLENEN_JURILER.filter(j=>!juriler.has(j));
                ogrHtml = `<b>${htmlEscape(ogrKisa)}</b>: <span class="${eksik.length?'jury-missing':'jury-ok'}">${juriler.size}/3 jüri</span>${eksik.length?` · Eksik: ${htmlEscape(eksik.join(', '))}`:' · Tamamlandı'}`;
                // Bir jüri puanlama formunda olmasa bile seçtiği öğrencinin ortak sayacı
                // son 1 dakikaya girdiyse uyarıyı seçim ekranında da alır.
                const timerId=ortakSureKimligi(secimler.okul,ogrKisa);
                const timer=sonMac?.konusmaSayaclari?.[timerId];
                if(timer)ortakSureBirDakikaUyarisiKontrolEt(timer,secimler.kategori,mac.id,timerId);
            }
            box.innerHTML = `<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><b>${htmlEscape(mac.etiket)}</b><span class="${sonMac.durum==='kapali'?'jury-missing':'jury-ok'}">${sonMac.durum==='kapali'?'MAÇ KAPALI':'MAÇ AÇIK'}</span></div><div style="margin-top:8px;">${ogrHtml}${secimler.ogr&&secimler.okul?secimEkraniOrtakSureMetni(sonMac,secimler.ogr,secimler.okul):''}</div><div style="margin-top:6px;font-size:12px;color:var(--text-muted);">Puan girilmiş öğrenci/maç: ${gruplar.size} · 3/3 tamamlanan: ${tam}</div>`;
        };
        aktifJuriListenerRef = db.ref('puanlar/' + secimler.kategori);
        aktifJuriListenerRef.on('value', s => { sonKayitlar = snapshotKayitlariniTekillestir(s); render(); });
        aktifJuriMacListenerRef = db.ref(`maclar/${secimler.kategori}/${mac.id}`);
        aktifJuriMacListenerRef.on('value', s => { sonMac = s.val() || {durum:'acik'}; render(); });
        // Seçim ekranındaki son-dakika uyarısı da Firebase sunucu saatiyle hesaplanır.
        void ortakSureSaatiSenkronizeEt();
        if(aktifSecimSureTick)clearInterval(aktifSecimSureTick);
        aktifSecimSureTick=setInterval(()=>{if(document.getElementById('canliJuriDurumu'))render();},1000);
    }

    // V3.18 - Bir öğrencinin konuşması için Firebase üzerinde ortak 6 dakikalık sayaç.
    // İlk jüri ekranı açıldığında başlar; diğer jüri ekranları aynı kaydı canlı izler.
    // Otomatik sayaç süreleri resmî eşitlik hesabını kendiliğinden değiştirmez;
    // süre modalında kontrol edilip kaydedildiğinde sureEsitlik'e aktarılır.
    const ORTAK_SURE_LIMIT=360;
    const ORTAK_SURE_UYARI=300;
    const ORTAK_PUAN_EK_SURE=60; // Altı dakikalık ortak sürenin ardından bütün jüriler için ek gönderim penceresi.
    function ortakSureYedekYolu(kategori,macId,timerId){
        return `arsiv/konusmaSureYedekleri/${kategori}/${macId}/${timerId}`;
    }
    async function ortakSureYedeginiKaydet(kategori,macId,timerId,veri,olay='guncelleme'){
        if(!veri)return;
        const at=Date.now();
        const m=puanlamaMaclar.get(macId)||mevcutMacBilgisi()||{};
        const yedek={...veri,macMeta:{id:macId,kategori,hukOkul:m.hukOkul||secimler.hukOkul||'',
            muhOkul:m.muhOkul||secimler.muhOkul||'',etiket:m.etiket||'',durum:m.durum||'acik',
            fiksturNo:m.fiksturNo||null,ogrenciKaynaklari:m.ogrenciKaynaklari||null},
            yedekClientAt:at,yedekOlayi:olay};
        const yol=ortakSureYedekYolu(kategori,macId,timerId);
        await db.ref(yol+'/sonDurum').transaction(cur=>{
            if(cur&&Number(cur.yedekClientAt||0)>at)return cur;
            return yedek;
        },undefined,false);
        await db.ref(yol+'/gecmis/'+String(at)).set(yedek);
    }
    function macSureYedekYolu(kategori,macId){return `arsiv/macSureYedekleri/${kategori}/${macId}`;}
    async function macSureYedeginiKaydet(kategori,macId,sure,olay='guncelleme'){
        if(!sure)return;
        const at=Date.now(),path=macSureYedekYolu(kategori,macId);
        const yedek={...sure,yedekClientAt:at,yedekOlayi:olay};
        await db.ref(path+'/sonDurum').transaction(cur=>{
            if(cur&&Number(cur.yedekClientAt||0)>at)return cur;
            return yedek;
        },undefined,false);
        await db.ref(path+'/gecmis/'+String(at)).set(yedek);
    }
    const JURI_SURE_AUDIT_OTURUM_KEY='munazaraJuriSureAuditOturumV1';
    const ortakSureUyariVerilenler=new Set();
    let ortakSureSunucuFarki=0,aktifOrtakSureRef=null,aktifOrtakSureTick=null;
    let aktifOrtakSureVerisi=null,aktifOrtakSureKimlik=null,ortakSureBittirmeCalisiyor=false;
    let aktifSecimSureTick=null;
    function ortakSureSimdi(){return Date.now()+ortakSureSunucuFarki;}
    async function ortakSureSaatiSenkronizeEt(){
        try{
            const snap=await db.ref('.info/serverTimeOffset').once('value');
            const offset=snap.val();
            if(typeof offset==='number')ortakSureSunucuFarki=offset;
        }catch(err){console.warn('Ortak süre için sunucu saati eşitlenemedi:',err);}
    }
    // Eski sürümlerde oluşmuş, gerçek 6 dakika dolmadan kapatılmış sayaçları tanır.
    // Yalnızca jüri açıkça 'Konuşma bitti' dediyse erken bitiş geçerlidir.
    function ortakSureErkenKapanmaKaydi(veri){
        if(!veri || !['bitti','tamamlandi'].includes(veri.durum))return false;
        if(veri.bitisNedeni==='konusma_bitti')return false;
        const bas=Number(veri.baslangicAt||0);
        if(!bas)return false;
        const bitis=Number(veri.bitisAt||0);
        return !bitis || bitis < bas + ORTAK_SURE_LIMIT*1000;
    }
    function ortakPuanSonAt(veri){
        const bas=Number(veri?.baslangicAt||0);
        if(!bas)return 0;
        // Bir jüri "Konuşma bitti" dese bile ortak puanlama penceresi kısaltılmaz.
        // Her jüri, aynı başlangıçtan itibaren 6 dakika + 1 dakikaye kadar gönderebilir.
        return bas+(ORTAK_SURE_LIMIT+ORTAK_PUAN_EK_SURE)*1000;
    }
    function ortakPuanPenceresiAcik(veri,kontrolAni=ortakSureSimdi()){
        const son=ortakPuanSonAt(veri);
        return !!son && Number(kontrolAni)<=son;
    }
    function ortakPuanPenceresiKapandi(veri,kontrolAni=ortakSureSimdi()){
        const son=ortakPuanSonAt(veri);
        return !!son && Number(kontrolAni)>son;
    }
    function juriSureDenetimTemeli(extra={}){
        const ot=juriOturumuGetir();
        const mac=puanlamaMaclar.get(secimler.macId)||mevcutMacBilgisi()||{};
        return {
            kategori:secimler.kategori||'', macId:mac.id||secimler.macId||'',
            macEtiketi:mac.etiket||macEtiketi(secimler.hukOkul,secimler.muhOkul),
            fiksturTarihi:mac.fiksturTarih||mac.tarih||'',
            okul:secimler.okul||'', ogrenci:(secimler.ogr||'').split(' (')[0], taraf:secimler.taraf||'',
            juri:ot?.juri||secimler.juri||'', juriAd:ot?.ad||secimler.juriAd||'',
            cihazId:getClientId(), uygulamaSurumu:APP_VERSION, ...extra
        };
    }
    const JURI_SURE_AUDIT_KUYRUK_KEY='munazaraJuriSureAuditKuyrukV1';
    function juriSureAuditKuyruguGetir(){try{return JSON.parse(localStorage.getItem(JURI_SURE_AUDIT_KUYRUK_KEY)||'[]')||[];}catch(_){return [];}}
    function juriSureAuditKuyruguKaydet(q){localStorage.setItem(JURI_SURE_AUDIT_KUYRUK_KEY,JSON.stringify(q));}
    async function juriSureAuditKuyrugunuGonder(){
        if(!navigator.onLine||!firebaseBagli)return;
        const q=juriSureAuditKuyruguGetir();if(!q.length)return;
        const kalan=[];
        for(const item of q){
            try{await db.ref(`arsiv/juriSureOlaylari/${item.kategori}/${item.logId}`).set({...item.kayit,
                createdAt:firebase.database.ServerValue.TIMESTAMP,syncDurumu:'senkronize'});}
            catch(err){console.warn('Bekleyen jüri/süre günlüğü senkronize edilemedi:',err);kalan.push(item);}
        }
        juriSureAuditKuyruguKaydet(kalan);
    }
    function juriSureYerelAuditGuncelle(kategori,logId,patch){
        const q=juriSureAuditKuyruguGetir();const item=q.find(x=>x.kategori===kategori&&x.logId===logId);
        if(!item)return false;
        item.kayit={...item.kayit,...patch,updatedClientAt:Date.now(),syncDurumu:'bekliyor'};
        juriSureAuditKuyruguKaydet(q);return true;
    }
    function juriSureAuditGuncellemeKuyrugaAl(kategori,logId,temel,patch){
        const q=juriSureAuditKuyruguGetir();
        const item=q.find(x=>x.kategori===kategori&&x.logId===logId);
        const kayit={...(item?.kayit||temel||{}),...patch,kategori,logId,updatedClientAt:Date.now(),syncDurumu:'bekliyor'};
        if(item)item.kayit=kayit;else q.push({kategori,logId,kayit});
        juriSureAuditKuyruguKaydet(q);
    }
    async function juriSureOlayiYaz(kayit){
        const kategori=(kayit?.kategori||secimler.kategori||'ORTAOKUL');
        const clientAt=Date.now();
        const govde={...juriSureDenetimTemeli(),...kayit,kategori,clientAt,
            clientId:getClientId(),uygulamaSurumu:APP_VERSION};
        if(!navigator.onLine||!firebaseBagli){
            const logId='pending_'+clientAt+'_'+hash32(String(Math.random())+'|'+getClientId());
            const q=juriSureAuditKuyruguGetir();
            q.push({kategori,logId,kayit:{...govde,logId,syncDurumu:'bekliyor'}});
            juriSureAuditKuyruguKaydet(q);
            return {key:logId,kategori,local:true,update:async patch=>{if(!juriSureYerelAuditGuncelle(kategori,logId,patch))throw new Error('Yerel denetim kaydı kuyruğu bulunamadı.');}};
        }
        const ref=db.ref(`arsiv/juriSureOlaylari/${kategori}`).push();
        await ref.set({...govde,logId:ref.key,createdAt:firebase.database.ServerValue.TIMESTAMP});
        return {key:ref.key,kategori,local:false,update:patch=>ref.update({...patch,updatedAt:firebase.database.ServerValue.TIMESTAMP})};
    }
    async function juriSureOturumLogunuGuncelle(patch){
        let d=null,base=null;
        try{
            const raw=localStorage.getItem(JURI_SURE_AUDIT_OTURUM_KEY);if(!raw)return;
            d=JSON.parse(raw);if(!d?.kategori||!d?.logId)return;
            base=juriSureDenetimTemeli();
            if(d.kategori!==base.kategori||d.macId!==base.macId||
               puanMetniNormalize(d.okul)!==puanMetniNormalize(base.okul)||
               puanMetniNormalize(d.ogrenci)!==puanMetniNormalize(base.ogrenci))return;
            if(d.local&&juriSureYerelAuditGuncelle(d.kategori,d.logId,patch))return;
            await db.ref(`arsiv/juriSureOlaylari/${d.kategori}/${d.logId}`).update({...patch,updatedAt:firebase.database.ServerValue.TIMESTAMP});
        }catch(err){
            console.warn('Jüri/süre oturum günlüğü güncellenemedi; yerel denetim kuyruğuna alınacak:',err);
            if(d?.kategori&&d?.logId){
                try{juriSureAuditGuncellemeKuyrugaAl(d.kategori,d.logId,base||{},patch);}
                catch(queueErr){console.warn('Jüri/süre denetim günlüğü yerel kuyruğa da yazılamadı:',queueErr);}
            }
        }
    }
    async function juriSureOturumLogla(durum='acildi',ek={}){
        try{
            const rec=await juriSureOlayiYaz({islem:'puanlama_ekrani_acma',durum,
                sifirlamaSecenegiSunuldu:true,sifirlamaTalepEdildi:false,sifirlamaKullanildi:false,
                sifirlamaDurumu:'kullanilmadi',izinVerilenEkSureSaniye:ORTAK_PUAN_EK_SURE,...ek});
            localStorage.setItem(JURI_SURE_AUDIT_OTURUM_KEY,JSON.stringify({kategori:secimler.kategori,
                logId:rec.key,local:!!rec.local,macId:secimler.macId,okul:secimler.okul,
                ogrenci:(secimler.ogr||'').split(' (')[0],clientAt:Date.now()}));
        }catch(err){console.warn('Puanlama açılış denetim kaydı yazılamadı:',err);}
    }
    async function juriSurePenceresiniSifirla(kaynak='juri_secim_ekrani'){
        const oturum=juriOturumuGetir();
        const mac=puanlamaMaclar.get(secimler.macId)||mevcutMacBilgisi();
        const ogr=(secimler.ogr||'').split(' (')[0];
        if(!mac?.id||!secimler.okul||!ogr||!secimler.taraf){
            alert('Sıfırlama için önce maç, taraf ve öğrenci seçilmelidir. Puanlar silinmez; yalnızca seçili öğrencinin ortak süresi yenilenir.');return;
        }
        let auditRef=null;
        const logTemel=juriSureDenetimTemeli({islem:'ortak_sure_sifirlama',durum:'onay_bekliyor',
            kaynakEkran:kaynak,istegeBagli:true,sifirlamaTalepEdildi:true,sifirlamaKullanildi:false,uygulandi:false,
            sebep:'',oncekiSayac:null,yeniSayac:null});
        try{auditRef=await juriSureOlayiYaz(logTemel);}
        catch(err){alert('Denetim kaydı yazılamadığı için sıfırlama yapılmadı. Firebase bağlantısını kontrol edin.\n'+String(err?.message||err));return;}
        const auditGuncelle=async patch=>{
            try{await auditRef.update(patch);return true;}
            catch(e){
                console.warn('Sıfırlama sonucu günlüğe yazılamadı; yerel aktarım kuyruğuna alınıyor:',e);
                juriSureAuditGuncellemeKuyrugaAl(auditRef.kategori,auditRef.key,logTemel,patch);
                return false;
            }
        };
        if(!navigator.onLine||!firebaseBagli){
            await auditGuncelle({durum:'baglanti_yok',hata:'Çevrimdışı olduğu için ortak sayaç sıfırlanmadı.',uygulandi:false,sifirlamaKullanildi:false});
            alert('Ortak süre bütün jüri cihazlarında aynı anda sıfırlanabilmesi için internet bağlantısı gerekir. İşlem yapılmadı; bu sonuç yerel günlüğe alındı ve bağlantı gelince yönetici günlüğüne aktarılacak.');return;
        }
        if(!oturum||!juriOturumuSeciliMacaUygun(oturum,mac)){
            await auditGuncelle({durum:'juri_kilidi_uyumsuz',hata:'Seçili maçın gününe/kategorisine uygun jüri kilidi yok.',uygulandi:false,sifirlamaKullanildi:false});
            alert('Önce seçili maç için geçerli jüri kilidini seçin. Sıfırlama yapılmadı; talep günlüğe kaydedildi.');return;
        }
        const vazgec=async neden=>{
            await auditGuncelle({durum:'iptal_edildi',iptalNedeni:neden,uygulandi:false,sifirlamaKullanildi:false});
            await juriSureOturumLogunuGuncelle({sifirlamaTalepEdildi:true,sifirlamaKullanildi:false,sifirlamaDurumu:'iptal_edildi'});
        };
        if(!confirm(`İSTEĞE BAĞLI SIFIRLAMA

${mac.etiket||'Seçili maç'} · ${ogr}

Bu işlem yalnızca seçili öğrencinin ortak 6 dakikalık sayacını tüm jüri cihazlarında yeniden başlatır. Mevcut puan kayıtları silinmez. İşlem yönetici günlüğüne kaydedilecektir.

Devam edilsin mi?`)){
            await vazgec('Kullanıcı onay vermedi');return;
        }
        const sebep=prompt('Sıfırlama gerekçesini yazın (ör. puanlama ekranı açılmadı, sayaç hatalı başladı):');
        if(sebep===null||!sebep.trim()){
            await vazgec('Gerekçe girilmedi veya işlem iptal edildi');
            alert('Sıfırlama iptal edildi. Sayaç değiştirilmedi; iptal denetim günlüğüne kaydedildi.');return;
        }
        try{
            const macDurum=await macDurumuGetir(secimler.kategori,mac.id);
            if(['kapali','iptal'].includes(macDurum?.durum))throw new Error('Maç kapatılmış veya iptal edilmiş; ortak süre sıfırlanmadı.');
            const offset=(await db.ref('.info/serverTimeOffset').once('value')).val();
            if(typeof offset==='number')ortakSureSunucuFarki=offset;
            const id=ortakSureKimligi(secimler.okul,ogr);
            const ref=db.ref(`maclar/${secimler.kategori}/${mac.id}/konusmaSayaclari/${id}`);
            const oncekiSnap=await ref.once('value');
            const onceki=oncekiSnap.val()||null;
            if(onceki)await ortakSureYedeginiKaydet(secimler.kategori,mac.id,id,onceki,'sifirlama_oncesi');
            const resetAni=ortakSureSimdi();
            const result=await ref.transaction(cur=>({
                ...(cur||{}),ogrenci:ogr,okul:secimler.okul,taraf:secimler.taraf,
                baslangicAt:resetAni,limitSaniye:ORTAK_SURE_LIMIT,durum:'calisiyor',
                kaynak:'juri_puanlama_sifirlama',version:(Number(cur?.version)||1)+1,
                sifirlamaSayisi:(Number(cur?.sifirlamaSayisi)||0)+1,
                sonSifirlama:{at:resetAni,sebep:sebep.trim(),juri:oturum?.juri||secimler.juri||'',
                    juriAd:oturum?.ad||secimler.juriAd||'',clientId:getClientId(),kaynakEkran:kaynak},
                sureSaniye:null,bitisAt:null,bitisNedeni:null
            }),undefined,false);
            if(!result.committed)throw new Error('Firebase ortak süreyi güncelleyemedi; yeniden deneyin.');
            const yeni=result.snapshot?.val()||null;
            if(yeni)await ortakSureYedeginiKaydet(secimler.kategori,mac.id,id,yeni,'sifirlama_sonrasi');
            const logBulutaYazildi=await auditGuncelle({durum:'uygulandi',sebep:sebep.trim(),uygulandi:true,sifirlamaKullanildi:true,
                oncekiSayac:onceki,yeniSayac:yeni,sifirlamaAt:resetAni,
                resetSayisi:Number(yeni?.sifirlamaSayisi)||1});
            await juriSureOturumLogunuGuncelle({sifirlamaTalepEdildi:true,sifirlamaKullanildi:true,
                sifirlamaDurumu:'uygulandi',sifirlamaAt:resetAni,sifirlamaSebebi:sebep.trim()});
            alert('Ortak süre sıfırlandı. Bütün jüri cihazlarında aynı öğrenci için yeni 6:00 + en fazla 1 dakikalık puanlama penceresi başladı. Puanlar silinmedi. '+(logBulutaYazildi?'İşlem günlüğe kaydedildi.':'Sonuç yerel denetim kuyruğuna alındı; bağlantı gelince yönetici günlüğüne aktarılacak.'));
        }catch(err){
            await auditGuncelle({durum:'basarisiz',hata:String(err?.message||err),uygulandi:false,sifirlamaKullanildi:false});
            await juriSureOturumLogunuGuncelle({sifirlamaTalepEdildi:true,sifirlamaKullanildi:false,
                sifirlamaDurumu:'basarisiz',sifirlamaHatasi:String(err?.message||err)});
            alert('Ortak süre sıfırlanamadı. Puanlar ve sayaç korunmuştur.\n'+String(err?.message||err)+'\nİşlem sonucu yönetici günlüğüne yazıldı.');
        }
    }
    function ortakSureKimligi(okul,ogrenci){
        const key=[skorEslesmeAnahtari(okul),skorEslesmeAnahtari(ogrenci)].join('|');
        return 's_'+hash32(key,2166136261)+hash32(key,3339675911);
    }
    function ortakSureKalan(veri){
        if(!veri)return null;
        // Eski sürüm veya başka bir istemci sayacı erken kapattıysa gerçek 6 dakika
        // dolana kadar çalışan sayaç gibi değerlendir; puan kaydı sayaç durumunu değiştirmez.
        const eskiErkenKapanma=ortakSureErkenKapanmaKaydi(veri);
        const kapaliDurum=['bitti','tamamlandi'].includes(veri.durum) && !eskiErkenKapanma;
        const sinir=!kapaliDurum ? ORTAK_SURE_LIMIT : (Number(veri.limitSaniye)||ORTAK_SURE_LIMIT);
        const gecti=kapaliDurum
            ? Math.max(0,Number(veri.sureSaniye)||0)
            : Math.max(0,Math.floor((ortakSureSimdi()-Number(veri.baslangicAt||0))/1000));
        const bitti=kapaliDurum || gecti>=sinir;
        return {gecen:Math.min(sinir,gecti),kalan:Math.max(0,sinir-gecti),bitti};
    }
    function ortakSureTemizle(){
        if(aktifOrtakSureRef){try{aktifOrtakSureRef.off();}catch(_){}aktifOrtakSureRef=null;}
        if(aktifOrtakSureTick)clearInterval(aktifOrtakSureTick);
        aktifOrtakSureTick=null;aktifOrtakSureKimlik=null;aktifOrtakSureVerisi=null;
        if(aktifSecimSureTick)clearInterval(aktifSecimSureTick);
        aktifSecimSureTick=null;
    }
    async function ortakSureBaslat(kategori,mac,okul,ogrenci){
        const host=document.getElementById('ortakKonusmaSayaci');if(!host)return;
        const ad=(ogrenci||'').split(' (')[0];
        const id=ortakSureKimligi(okul,ad);
        const ref=db.ref(`maclar/${kategori}/${mac.id}/konusmaSayaclari/${id}`);
        ortakSureTemizle();aktifOrtakSureKimlik={kategori,macId:mac.id,id,ogrenci:ad,okul};
        host.textContent='⏱ Ortak 6 dakikalık süre Firebase’den kontrol ediliyor…';
        try{
            const offset=(await db.ref('.info/serverTimeOffset').once('value')).val();
            if(typeof offset==='number')ortakSureSunucuFarki=offset;
            if(!document.getElementById('ortakKonusmaSayaci') || aktifOrtakSureKimlik?.id!==id)return;
            aktifOrtakSureRef=ref;
            ref.on('value',snapshot=>{
                if(aktifOrtakSureRef!==ref)return;
                aktifOrtakSureVerisi=snapshot.val();ortakSureGoster();
            },err=>{if(aktifOrtakSureRef===ref){aktifOrtakSureVerisi=null;host.innerHTML='Sayaç okunamadı: '+htmlEscape(err.message||err)+'<div><button class="btn" style="width:auto;margin-top:8px;background:#92400e" onclick="juriSurePenceresiniSifirla(\'puanlama_ekrani\')">↻ Sorun giderme için ortak süreyi sıfırla</button></div>';ortakPuanArayuzunuGuncelle();}});
            aktifOrtakSureTick=setInterval(ortakSureGoster,1000);
            const m=await macDurumuGetir(kategori,mac.id);
            if(m.durum==='kapali'||m.durum==='iptal')return;
            // Veri zaten varsa kimse yeniden başlatamaz (birden çok jüri güvenli).
            if(!navigator.onLine||!firebaseBagli){
                if(host)host.textContent='Bağlantı yok: ortak sayaç başlatılmadı.';
                return;
            }
            let yedek=null;
            const mevcut=await ref.once('value');
            if(!mevcut.exists()){
                try{
                    const yedekSnap=await db.ref(ortakSureYedekYolu(kategori,mac.id,id)+'/sonDurum').once('value');
                    yedek=yedekSnap.val()||null;
                }catch(err){console.warn('Ortak süre arşiv yedeği okunamadı:',err);}
            }
            const yedekGecerli=!!(yedek&&Number(yedek.baslangicAt)>0&&
                ['calisiyor','bitti','tamamlandi'].includes(yedek.durum));
            const baslatma=await ref.transaction(cur=>{
                if(cur)return cur;
                if(yedekGecerli)return {...yedek,arsivdenGeriYuklendiAt:ortakSureSimdi()};
                return {ogrenci:ad,okul,taraf:secimler.taraf,baslangicAt:ortakSureSimdi(),
                    limitSaniye:ORTAK_SURE_LIMIT,durum:'calisiyor',kaynak:'juri_puanlama',version:1};
            },undefined,false);
            const sonVeri=baslatma.snapshot?.val()||null;
            if(sonVeri){
                void ortakSureYedeginiKaydet(kategori,mac.id,id,sonVeri,
                    baslatma.committed&&yedekGecerli?'arsivden_geri_yuklendi':'sayac_kontrol')
                    .catch(err=>console.warn('Ortak süre yedeği yazılamadı:',err));
                if(baslatma.committed&&yedekGecerli){
                    const bilgi=document.getElementById('ortakKonusmaSayaci');
                    if(bilgi)bilgi.dataset.recoveredFromArchive='true';
                }
            }
        }catch(err){
            const alan=document.getElementById('ortakKonusmaSayaci');
            aktifOrtakSureVerisi=null;
            if(alan)alan.innerHTML='Ortak sayaç başlatılamadı: '+htmlEscape(String(err?.message||err))+'<div><button class="btn" style="width:auto;margin-top:8px;background:#92400e" onclick="juriSurePenceresiniSifirla(\'puanlama_ekrani\')">↻ Sorun giderme için ortak süreyi sıfırla</button></div>';
            ortakPuanArayuzunuGuncelle();
        }
    }
    function ortakSureUyariSesiCal(){
        // Ses engellense bile görünür uyarı aşağıda mutlaka gösterilir.
        try{
            const AudioSinifi=window.AudioContext||window.webkitAudioContext;
            if(!AudioSinifi)return;
            const audio=new AudioSinifi();
            const ses=audio.createOscillator();
            const seviye=audio.createGain();
            ses.type='sine';ses.frequency.value=880;
            seviye.gain.value=0.12;
            ses.connect(seviye);seviye.connect(audio.destination);
            ses.start();ses.stop(audio.currentTime+0.35);
            ses.onended=()=>{void audio.close();};
        }catch(e){console.warn('Süre uyarısı sesi açılamadı:',e);}
    }
    function ortakSureBirDakikaUyarisiKontrolEt(veri,kategori,macId,timerId){
        if(!veri)return;
        const s=ortakSureKalan(veri);
        if(!s||s.bitti||s.gecen<ORTAK_SURE_UYARI)return;
        const eskiErkenKapanma=ortakSureErkenKapanmaKaydi(veri);
        const aktif=veri.durum==='calisiyor'||eskiErkenKapanma;
        if(!aktif)return;
        const anahtar=[kategori,macId,timerId,veri.baslangicAt].join('|');
        if(ortakSureUyariVerilenler.has(anahtar))return;
        ortakSureUyariVerilenler.add(anahtar);
        ortakSureUyariSesiCal();
        alert('⚠️ 5 dakika doldu! Ortak konuşma süresinin bitmesine 1 dakika kaldı. Bu uyarı seçili öğrenci için jüri ekranlarında gösterilir.');
    }
    function ortakPuanArayuzunuGuncelle(){
        document.querySelectorAll('#kriterListesi .puan-btn').forEach(btn=>{
            btn.style.pointerEvents='auto';btn.style.opacity='1';btn.setAttribute('aria-disabled','false');
        });
        const gonder=document.getElementById('btnPuanGonder');
        if(gonder){gonder.disabled=!!puanGonderiliyor;gonder.innerText=puanGonderiliyor?'Gönderiliyor...':'Puanları Gönder ✓';}
        const not=document.getElementById('puanGirisSureNotu'),veri=aktifOrtakSureVerisi;
        if(not){
            if(!veri||!Number(veri.baslangicAt))not.textContent='Süre doğrulaması bekleniyor; puan girişi açık ve taslaklar otomatik saklanır.';
            else if(ortakPuanPenceresiKapandi(veri))not.textContent='Ek 1 dakikalık süre doldu. Puan girişi açık kalır; geç gönderim yönetici incelemesi için arşivlenir.';
            else not.textContent='Puan girişi açık. 6 dakika sonunda 1 dakika ek gönderim süresi vardır.';
        }
    }
    function ortakSureGoster(){
        const host=document.getElementById('ortakKonusmaSayaci');
        if(!host)return;
        const v=aktifOrtakSureVerisi;
        const s=ortakSureKalan(v);
        if(!s){
            host.innerHTML=`⏱ Ortak sayaç henüz oluşmadı veya okunamadı. Puanlama penceresi doğrulanamıyor.
                <div><button class="btn" style="width:auto;margin-top:8px;background:#92400e" onclick="juriSurePenceresiniSifirla('puanlama_ekrani')">↻ Sorun giderme için ortak süreyi sıfırla</button></div>`;
            ortakPuanArayuzunuGuncelle();return;
        }
        const bitti=s.bitti;
        const eskiErkenKapanma=ortakSureErkenKapanmaKaydi(v);
        const ortakSayacAktif=v?.durum==='calisiyor'||(eskiErkenKapanma&&!bitti);
        const besDakikaUyarisi=ortakSayacAktif&&s.gecen>=ORTAK_SURE_UYARI;
        const sonAt=ortakPuanSonAt(v);
        const simdi=ortakSureSimdi();
        const puanKapandi=simdi>sonAt;
        const ekSureKalan=Math.max(0,Math.ceil((sonAt-simdi)/1000));
        const altiDakikaDoldu=simdi>=Number(v.baslangicAt||0)+ORTAK_SURE_LIMIT*1000;
        const ekSureAktif=bitti&&!puanKapandi;
        const erkenKonusmaBitisi=v?.bitisNedeni==='konusma_bitti';
        const baslik=puanKapandi?'PUAN GİRİŞ SÜRESİ DOLDU':erkenKonusmaBitisi?'KONUŞMA BİTTİ — JÜRİ PUANLAMASI DEVAM EDİYOR':ekSureAktif?(v.durum==='tamamlandi'?'6 DAKİKA DOLDU':'ORTAK SÜRE BİTTİ')+' — PUAN GÖNDERME İÇİN SON '+ekSureKalan+' SN':bitti?'SÜRE TAMAMLANDI':'Kalan süre: '+sureyiMetneDonustur(s.kalan);
        host.innerHTML=`<div style="font-size:17px;font-weight:bold;color:${puanKapandi?'#fb7185':ekSureAktif?'#facc15':bitti?'#fb7185':besDakikaUyarisi?'#facc15':'#38bdf8'}">⏱ ${baslik}</div>
            <div style="font-size:12px">${htmlEscape(v.ogrenci||'')} · Kullanılan: ${sureyiMetneDonustur(s.gecen)} · Firebase ortak sayacı</div>
            ${erkenKonusmaBitisi&&!puanKapandi?`<div role="status" style="background:#123b35;color:#a7f3d0;border:1px solid #0f766e;padding:10px;border-radius:8px;margin-top:8px;font-size:13px;font-weight:700;">Konuşma süresi ${sureyiMetneDonustur(s.gecen)} olarak kaydedildi. Diğer jüri üyeleri, ortak başlangıçtan itibaren 6 dakika + 1 dakikalık süre dolana kadar puanlamaya devam edebilir. Kalan puanlama süresi: ${sureyiMetneDonustur(ekSureKalan)}.</div>`:''}
            ${besDakikaUyarisi?'<div role="alert" style="background:#713f12;color:#fef08a;border:2px solid #facc15;padding:12px;border-radius:10px;margin-top:10px;font-size:17px;font-weight:800;">⚠️ 5. DAKİKA DOLDU — SON 1 DAKİKA! Öğrenciyi uyarın.</div>':''}
            ${ekSureAktif&&!erkenKonusmaBitisi?`<div role="alert" style="background:#713f12;color:#fef08a;border:1px solid #facc15;padding:9px;border-radius:8px;margin-top:8px;font-size:13px;font-weight:750;">⚠️ Puan göndermek için yalnızca ${ekSureKalan} saniye kaldı. Süre dolunca puan seçimi ve gönderme kapanır.</div>`:''}
            ${puanKapandi?'<div role="alert" style="background:#451a1a;color:#fecaca;border:1px solid #b91c1c;padding:9px;border-radius:8px;margin-top:8px;font-size:13px;font-weight:750;">Ortak sayaç bittikten sonra ek 1 dakika de tamamlandı. Puan seçimi/gönderme kapatıldı. Gerekliyse seçili öğrenci için isteğe bağlı sıfırlama yapın; bu işlem tüm jüri cihazlarını etkiler ve kayda alınır.</div>':''}
            ${!bitti?'<button class="btn" style="width:auto;margin-top:7px;padding:6px 12px;background:#475569" onclick="ortakSureErkenBitir()">⏹ Konuşma bitti — süreyi kaydet</button>':''}
            ${puanKapandi?`<button class="btn" style="width:auto;margin-top:7px;padding:7px 12px;background:#92400e" onclick="juriSurePenceresiniSifirla('puanlama_ekrani')">↻ Sorun varsa ortak süreyi sıfırla</button>`:''}`;
        ortakPuanArayuzunuGuncelle();
        if(besDakikaUyarisi&&(v.durum==='calisiyor'||eskiErkenKapanma))
            ortakSureBirDakikaUyarisiKontrolEt(v,aktifOrtakSureKimlik?.kategori,aktifOrtakSureKimlik?.macId,aktifOrtakSureKimlik?.id);
        // Sayaç yalnızca gerçek 6 dakika dolduğunda kapanır. Eski sürümün
        // erken puan gönderimiyle kapanmış kayıtları da burada onarılarak tamamlanır.
        if(bitti&&(v.durum==='calisiyor'||eskiErkenKapanma)&&!ortakSureBittirmeCalisiyor){
            ortakSureBittirmeCalisiyor=true;
            const k=aktifOrtakSureKimlik;
            void aktifOrtakSureRef.transaction(cur=>{
                const erkenKapanma=ortakSureErkenKapanmaKaydi(cur);
                if(!cur||!(cur.durum==='calisiyor'||erkenKapanma))return;
                const bas=Number(cur.baslangicAt||0);
                if(!bas||ortakSureSimdi()<bas+ORTAK_SURE_LIMIT*1000)return;
                return {...cur,durum:'tamamlandi',limitSaniye:ORTAK_SURE_LIMIT,
                    sureSaniye:ORTAK_SURE_LIMIT,bitisAt:bas+ORTAK_SURE_LIMIT*1000,
                    bitisNedeni:'sure_doldu'};
            },undefined,false).then(result=>{
                if(result.committed&&k){
                    void ortakSureYedeginiKaydet(k.kategori,k.macId,k.id,result.snapshot.val(),'sure_doldu')
                        .catch(e=>console.warn('Tamamlanan süre yedeklenemedi:',e));
                    void otomatikSureleriKaydet(k.kategori,k.macId);
                }
            }).catch(e=>console.warn('Süre tamamlanması senkronu:',e))
              .finally(()=>{ortakSureBittirmeCalisiyor=false;});
        }
    }
    // Geriye dönük uyumluluk: bu yardımcı artık yalnızca süre kaydını okur.
    // Puan gönderimi ortak sayaçta yazma yapmaz ve hiçbir jüriyi kilitlemez.
    async function ortakSurePuanGonderinceBitir(kategori,mac,okul,ogrenci,gondermeAni){
        const ad=(ogrenci||'').split(' (')[0];
        const id=ortakSureKimligi(okul,ad);
        const ref=db.ref(`maclar/${kategori}/${mac.id}/konusmaSayaclari/${id}`);
        const snap=await ref.once('value');
        const veri=snap.val();
        if(!veri)throw new Error('Bu öğrenci için ortak sayaç kaydı bulunamadı.');
        return veri;
    }
    async function ortakSureErkenBitir(){
        if(!aktifOrtakSureRef||!aktifOrtakSureVerisi||!confirm('Konuşma tamamlandı mı? Geçen süre öğrenci adına Firebase’e kaydedilecek.'))return;
        try{
            const result=await aktifOrtakSureRef.transaction(cur=>{
                if(!cur||cur.durum!=='calisiyor')return;
                const s=ortakSureKalan(cur);
                return {...cur,durum:'bitti',limitSaniye:ORTAK_SURE_LIMIT,sureSaniye:s.gecen,bitisAt:ortakSureSimdi(),bitisNedeni:'konusma_bitti'};
            },undefined,false);
            if(result.committed&&aktifOrtakSureKimlik){
                const k=aktifOrtakSureKimlik;
                await ortakSureYedeginiKaydet(k.kategori,k.macId,k.id,result.snapshot.val(),'konusma_bitti');
                await otomatikSureleriKaydet(k.kategori,k.macId);
            }
            if(!result.committed)alert('Süre başka jüri tarafından tamamlanmış; güncel kayıt görüntüleniyor.');
        }catch(err){alert('Öğrenci konuşma süresi kaydedilemedi: '+String(err?.message||err));}
    }
    function secimEkraniOrtakSureMetni(mac,ogr,okul){
        const v=mac?.konusmaSayaclari?.[ortakSureKimligi(okul,(ogr||'').split(' (')[0])];
        const s=ortakSureKalan(v);
        if(!s)return '';
        return `<div style="margin-top:7px;color:${s.bitti?'#fda4af':s.gecen>=ORTAK_SURE_UYARI?'#facc15':'#7dd3fc'}">⏱ Ortak öğrenci süresi: ${s.bitti?'tamamlandı ('+sureyiMetneDonustur(s.gecen)+')':s.gecen>=ORTAK_SURE_UYARI?'⚠️ Son 1 dakika — kalan '+sureyiMetneDonustur(s.kalan):'kalan '+sureyiMetneDonustur(s.kalan)}</div>`;
    }

    async function puanlamaSayfasinaGec() {
        const oturum = juriOturumuGetir();
        if (!oturum) return alert('Önce bu cihazı 1., 2. veya 3. jüriye kilitleyin.');
        secimler.juri = oturum.juri;
        secimler.juriAd = oturum.ad;
        if(!secimler.taraf || !secimler.juri || !secimler.ogr || !secimler.okul || !secimler.hukOkul || !secimler.muhOkul) return alert('Lütfen seçimleri eksiksiz yapın!');
        const fixtureMac=puanlamaMaclar.get(secimler.macId);
        if(!juriOturumuSeciliMacaUygun(oturum,fixtureMac))
            return alert('Bu jüri kilidi seçili maçın günü/kategorisi için geçerli değil. “Jüri Kilidini Kaldır” düğmesiyle kilidi kaldırın ve günün asıl jüri listesinden kendi adınızı seçin.');
        const source=fixtureMac?puanlamaKaynakAdi(fixtureMac,secimler.taraf):puanlamaTamOkulEslesmesi(secimler.okul);
        if(!source || !(puanlamaKayitliOkullar[source]||[]).length)
            return alert('Bu okulun öğrenci listesi bulunamadı. Önce öğrenci kayıtlarını kontrol edin veya okul eşleştirmesini kaydedin.');
        if(!(puanlamaKayitliOkullar[source]||[]).some((ad,i)=>`${ad} (${i<3?i+1+'. Konuşmacı':'Grup Sözcüsü'})`===secimler.ogr))
            return alert('Seçilen öğrenci kayıtlı listede bulunamadı. Önce öğrenci seçimini yenileyin.');
        const mac = mevcutMacBilgisi();
        if (!mac) return alert('Maç bilgisi eksik.');
        secimler.macId=mac.id;
        aktifPuanTaslak=puanTaslakBaglamiOlustur(mac,oturum);
        verilenPuanlar={};
        // Süre/maç durumu puanlama ekranını engellemez; gönderim aşamasında ayrıca denetlenir.
        verilenPuanlar = {};
        const html = `<div class="card juri-scoring-card">
                    <header class="juri-scoring-header">
                        <div><span class="juri-page-eyebrow">JÜRİ DEĞERLENDİRMESİ</span><h2>${htmlEscape(secimler.ogr)}</h2>
                        <p>${htmlEscape(secimler.kategori)} · ${htmlEscape(mac.etiket)} · ${htmlEscape(secimler.okul)}</p></div>
                        <span class="juri-scoring-role">${htmlEscape(oturum.juri)} · ${htmlEscape(oturum.ad)}</span>
                    </header>
                    <div id="ortakKonusmaSayaci" class="puanlama-bilgi">⏱ Ortak süre başlatılıyor…</div>
                    <div id="puanGirisSureNotu" class="puanlama-bilgi">Süre doğrulaması bekleniyor; puan girişi açıktır.</div>
                    <div id="juriSureBilgisi" class="puanlama-bilgi">Resmî öğrenci süresi kontrol ediliyor…</div>
                    <section class="puan-progress-card" aria-live="polite">
                        <div class="puan-progress-top"><div><span>PUANLAMA İLERLEMESİ</span><strong id="puanIlerlemeAdet">0 / 13 kriter</strong></div><div class="puan-progress-total"><small>TOPLAM PUAN</small><b id="puanIlerlemeToplam">0 / 100</b></div></div>
                        <div class="puan-progress-track"><div id="puanIlerlemeBar" style="width:0%"></div></div>
                        <div class="puan-progress-foot"><span id="puanIlerlemeMesaj">Her kriterden bir puan seçin.</span><span id="puanIlerlemeKalan">13 kriter kaldı</span></div>
                    </section>
                    <div id="kriterListesi" class="juri-criteria-grid"></div>
                    <div id="puanTaslakDurumu" class="puanlama-bilgi juri-draft-status">Puan seçimleriniz otomatik taslak olarak cihazda saklanır. Bu kayıt resmî puan değildir.</div>
                    <div id="puanFirebaseDurumu" class="puanlama-bilgi hata" role="alert" style="display:none;"></div>
                    <div class="puanlama-action-bar">
                        <div class="puan-action-summary"><strong id="puanIlerlemeMini">0 / 13</strong><span>Kriter tamamlandı</span></div>
                        <button id="btnPuanGonder" class="btn" disabled onclick="puanlariGonder()">13 kriter tamamlanınca gönderilebilir</button>
                        <button type="button" class="puan-action-back" onclick="renderPuanlamaSecim()">← Seçime dön</button>
                    </div>
                </div>`;
        document.getElementById('app').innerHTML = html;
        puanFirebaseDurumuGoster();
        ortakPuanArayuzunuGuncelle();
        void juriSureOturumLogla('acildi',{izinVerilenEkSureSaniye:ORTAK_PUAN_EK_SURE,
            surePenceresi:'6 dakika + en fazla 1 dakika',sifirlamaSecenegiSunuldu:true,
            sifirlamaTalepEdildi:false,sifirlamaKullanildi:false,sifirlamaDurumu:'kullanilmadi'});
        const list = document.getElementById('kriterListesi');
        db.ref(`maclar/${secimler.kategori}/${mac.id}`).once('value').then(snapshot=>{
            const alan=document.getElementById('juriSureBilgisi');if(!alan)return;
            const m=snapshot.val()||{};
            const taraf=secimler.taraf==='HÜKÜMET'?'huk':'muh';
            const ad=skorEslesmeAnahtari((secimler.ogr||'').split(' (')[0]);
            const rec=(m.sureEsitlik?.ogrenciler?.[taraf]||[]).find(x=>skorEslesmeAnahtari(x.ad)===ad);
            alan.textContent=rec ? '⏱ Kayıtlı konuşma süresi: '+sureyiMetneDonustur(rec.saniye)
                : '⏱ Bu öğrenci için henüz resmî konuşma süresi kaydedilmemiş. Yönetici → Maç Yönetimi → Öğrenci Süreleri bölümünden kaydedilebilir.';
        }).catch(err=>{const alan=document.getElementById('juriSureBilgisi');if(alan)alan.textContent='Konuşma süresi okunamadı: '+String(err?.message||err);});
        void ortakSureBaslat(secimler.kategori,mac,secimler.okul,secimler.ogr);
        krit.forEach((k, i) => {
            const d = document.createElement('section');d.className='kriter-card puan-kriter-kart';d.dataset.kriterIndex=String(i);
            let kutular = '';
            for(let n=1;n<=k.m;n++)kutular += `<button type="button" class="puan-btn" aria-pressed="false" onclick="puanSec(this, ${i}, ${n})">${n}</button>`;
            d.innerHTML = `<div class="puan-kriter-head"><div class="puan-kriter-title"><span class="puan-kriter-no">${String(i+1).padStart(2,'0')}</span><span class="kriter-label">${htmlEscape(k.t)}</span></div><div class="puan-kriter-meta"><span class="puan-kriter-max">Maks. ${k.m}</span><b class="puan-kriter-value">Seçilmedi</b></div></div><div class="puan-row" role="group" aria-label="${htmlEscape(k.t)} puanı">${kutular}</div>`;
            list.appendChild(d);
        });
        puanlamaIlerlemesiniGuncelle();
        void puanTaslaginiGeriYukle(aktifPuanTaslak);
    }

    function puanlamaIlerlemesiniGuncelle(){
        const total=krit.length;
        const selected=krit.reduce((n,k,i)=>n+(Number.isInteger(verilenPuanlar?.[i])&&verilenPuanlar[i]>=1&&verilenPuanlar[i]<=k.m?1:0),0);
        const score=krit.reduce((n,k,i)=>n+(Number.isInteger(verilenPuanlar?.[i])?verilenPuanlar[i]:0),0);
        const maximum=krit.reduce((n,k)=>n+Number(k.m||0),0);
        const percent=total?Math.round(selected/total*100):0;
        const values={
            puanIlerlemeAdet:selected+' / '+total+' kriter',
            puanIlerlemeToplam:score+' / '+maximum,
            puanIlerlemeMini:selected+' / '+total,
            puanIlerlemeKalan:(total-selected)+' kriter kaldı',
            puanIlerlemeMesaj:selected===total?'✓ Değerlendirme tamamlandı. Gönderim için hazır.':(total-selected)+' kriter için puan seçilmesi gerekiyor.'
        };
        Object.entries(values).forEach(([id,value])=>{const el=document.getElementById(id);if(el)el.textContent=value;});
        const bar=document.getElementById('puanIlerlemeBar');if(bar)bar.style.width=percent+'%';
        const submit=document.getElementById('btnPuanGonder');
        if(submit){
            submit.disabled=selected!==total||puanGonderiliyor;
            submit.textContent=selected===total?'Puanları güvenle gönder ✓':(total-selected)+' kriter daha gerekli';
        }
        document.querySelectorAll('#kriterListesi .puan-kriter-kart').forEach(card=>{
            const i=Number(card.dataset.kriterIndex),v=verilenPuanlar?.[i],valid=Number.isInteger(v)&&v>=1&&v<=Number(krit[i]?.m);
            card.classList.toggle('is-complete',valid);
            const label=card.querySelector('.puan-kriter-value');if(label)label.textContent=valid?(v+' / '+krit[i].m+' puan'):'Seçilmedi';
            card.querySelectorAll('.puan-btn').forEach(btn=>btn.setAttribute('aria-pressed',btn.classList.contains('selected')?'true':'false'));
        });
    }

    function puanSec(element, kriterIndex, puan) {
        if(!element || !element.parentElement || !Number.isInteger(Number(puan)))return;
        element.parentElement.querySelectorAll('.puan-btn').forEach(x => {
            x.classList.remove('selected');x.setAttribute('aria-pressed','false');
        });
        element.classList.add('selected');element.setAttribute('aria-pressed','true');
        verilenPuanlar[kriterIndex] = Number(puan);
        puanlamaIlerlemesiniGuncelle();
        puanTaslaginiKaydet();
    }

    async function puanlariGonder() {
        if (puanGonderiliyor) return;
        // Tıklama anı kaydedilir; süre kontrolü puan yerel kuyruğa yazıldıktan sonra yapılır.
        const puanGondermeAni=ortakSureSimdi();
        // Gönderim öncesi 13 kriterin tamamını tek tek doğrula.
        // Sadece kayıt sayısına bakmak, geçersiz/eksik indeksleri veya sınır dışı puanları yakalamaz.
        if(krit.length !== 13) return alert('Puanlama yapılandırmasında 13 kriter bulunamadı. Yöneticiye bildiriniz; puanlar taslakta korunuyor.');
        const eksikVeyaGecersiz = [];
        for(let i=0;i<13;i++){
            const puan=verilenPuanlar?.[i];
            const maxPuan=Number(krit[i]?.m);
            if(!Number.isInteger(puan)||puan<1||puan>maxPuan){
                eksikVeyaGecersiz.push(`${i+1}. kriter — ${krit[i].t} (1-${maxPuan} arası tam sayı)`);
            }
        }
        if(eksikVeyaGecersiz.length){
            return alert('Puanlar gönderilmedi. Lütfen aşağıdaki kriterleri tamamlayın veya düzeltin:\n\n'+eksikVeyaGecersiz.join('\n')+'\n\nMevcut puanlarınız taslak olarak korunmuştur.');
        }
        const oturum = juriOturumuGetir();
        if (!oturum) return alert('Günün jüri listesinden adınızı seçip kilitleyin.');
        const seciliFixture = puanlamaMaclar.get(secimler.macId);
        if(!juriOturumuSeciliMacaUygun(oturum,seciliFixture))
            return alert('Jüri kilidi seçili maçın günü/kategorisi için geçerli değil. Kilidi kaldırıp günün asıl jüri listesinden kendi adınızı seçin.');
        secimler.juri = oturum.juri;
        secimler.juriAd = oturum.ad;
        const mac = mevcutMacBilgisi();
        if (!mac) return alert('Maç bilgisi eksik.');
        secimler.macId = mac.id;
        secimleriKaydet();
        const kayitId = puanKayitKimligi(secimler, mac.id);
        const btn = document.getElementById('btnPuanGonder');
        puanGonderiliyor = true;
        if (btn) { btn.disabled = true; btn.innerText = 'Gönderiliyor...'; }

        const yerelZaman = Date.now();
        const kayitTemel = {
            secim: { ...secimler, juri: oturum.juri, juriAd: oturum.ad },
            puanlar: { ...verilenPuanlar },
            macId: mac.id,
            mac: macEskiEtiketi(mac.hukOkul, mac.muhOkul),
            macEtiketi: mac.etiket,
            clientId: getClientId(),
            localUpdatedAt: yerelZaman,
            puanGondermeAni,puanGondermeAniClientAt:yerelZaman,
            serverTimeOffsetAtClick:ortakSureSunucuFarki,
            version: 3
        };
        // Tam 13 kriterli puan, ilk Firebase ağ çağrısından önce yerel kuyruğa kopyalanır.
        const puanKuyrukItem={
            kategori:secimler.kategori,macId:mac.id,kayitId,
            kayit:{...kayitTemel,createdAt:yerelZaman,updatedAt:yerelZaman,queuedOffline:true},
            taslakYolu:aktifPuanTaslak?.cloudPath,taslakYerelAnahtari:aktifPuanTaslak?.localKey,
            queueStatus:'gonderim_on_kontrol',gonderimBaslatmaAt:yerelZaman,
            puanGondermeAni,puanGondermeAniClientAt:yerelZaman,
            serverTimeOffsetAtClick:ortakSureSunucuFarki
        };
        let puanKayitRef=null;
        let firebaseYazmaDenendi=false;
        let firebaseKaydiDogrulandi=false;
        puanFirebaseDurumuYaz('pending','Puan gönderimi başlatıldı. Firebase kaydı geri okunup doğrulanana kadar gönderildi sayılmayacak.',{
            kayitId,macId:mac.id,ogr:secimler.ogr,juri:oturum.juri
        });

        try {
            const kaliciKuyrukKaydi=puaniKuyrugaEkle(puanKuyrukItem);
            Object.assign(puanKuyrukItem,kaliciKuyrukKaydi||{});
            await juriSureOturumLogunuGuncelle({
                durum:'puan_gonderimi_baslatildi',islem:'puan_kayit_aktarimi',
                hata:'13 kriterli puan gönderimi başladı; Firebase geri okuma doğrulaması bekleniyor.',
                kayitId,puanKayitId:kayitId,puanVerisi:{...kayitTemel.puanlar},
                puanGonderildi:false,puanKuyrugaAlindi:true,aktarimBaslatildiClientAt:yerelZaman
            });
            if (!navigator.onLine || !firebaseBagli) {
                puaniKuyrugaEkle({...puanKuyrukItem,queueStatus:'bekliyor'});
                await juriSureOturumLogunuGuncelle({durum:'puanlar_kuyruga_alindi',puanGonderildi:false,puanKuyrugaAlindi:true,
                    puanVerisi:{...kayitTemel.puanlar},kayitId,puanKayitId:kayitId,puanGondermeAniClient:puanGondermeAni});
                alert('İnternet bağlantısı yok. Puan bu cihazda kuyruğa alındı; bağlantı gelince gönderilecek. Ortak sayaç değiştirilmeyecek.');
                secimler.ogr = '';
                secimleriKaydet();
                return renderPuanlamaSecim(mac.id);
            }

            await ensureMatchExists(secimler.kategori, mac.hukOkul, mac.muhOkul);
            const m = await macDurumuGetir(secimler.kategori, mac.id);
            if (['kapali','iptal'].includes(m?.durum)) {
                const neden=m.durum==='iptal'
                    ?'Maç iptal edilmiş olduğu için jüri puanı resmî puan tablosuna alınmadı.'
                    :'Maç daha önce kapatılmış olduğu için jüri puanı resmî puan tablosuna alınmadı.';
                try{
                    await puanReddedilenKaydiniArsivle(puanKuyrukItem,neden,'puan_mac_kapali_arsivlendi');
                    puanKuyrugundanSil(secimler.kategori,kayitId);
                    await juriSureOturumLogunuGuncelle({durum:'puan_mac_kapali_arsivlendi',hata:neden,
                        puanVerisi:{...kayitTemel.puanlar},kayitId,puanGonderildi:false,reddedilenPuanArsivlendi:true});
                    alert('Maç kapalı/iptal olduğu için puan resmî sonuca eklenmedi. Girilen 13 kriter Firebase arşivine kaydedildi ve yönetici incelemesine açıldı.');
                }catch(arsivErr){
                    puanKuyrukDurumunuGuncelle(secimler.kategori,kayitId,{queueStatus:'mac_kapali_arsiv_bekliyor',
                        officialSendAllowed:false,reddedilmeNedeni:neden,lastError:String(arsivErr?.message||arsivErr)});
                    await juriSureOturumLogunuGuncelle({durum:'puan_mac_kapali_arsiv_hatasi',hata:String(arsivErr?.message||arsivErr),
                        puanVerisi:{...kayitTemel.puanlar},kayitId,puanGonderildi:false});
                    alert('Maç kapalı/iptal olduğu için puan resmî sonuca eklenmedi. Arşiv aktarımı şu an tamamlanamadı; 13 kriter bu cihazın kuyruğunda korundu. Yöneticiyle kontrol edin.');
                }
                return;
            }

            // Her jüri, kendi deterministik puan kayıt anahtarına yazar. Bütün kategori
            // kayıtlarını okumak veya kategori düğümüne toplu update göndermek gerekmez.
            puanKayitRef=db.ref(`puanlar/${secimler.kategori}/${kayitId}`);
            const oncekiSnap=await puanKayitRef.once('value');
            const onceki=oncekiSnap.val()||null;
            if(onceki){
                const ogrAd=(secimler.ogr||'').split(' (')[0];
                const onay=confirm(`${oturum.juri} tarafından ${ogrAd} için daha önce puan gönderilmiş.\n\nYalnızca bu jüriye ait önceki kayıt güncellenecek. Devam edilsin mi?`);
                if(!onay){
                    puanKuyrugundanSil(secimler.kategori,kayitId);
                    await juriSureOturumLogunuGuncelle({durum:'puan_gonderimi_iptal_edildi',
                        hata:'Jüri önceki puanı güncelleme onayını vermedi; yeni gönderim iptal edildi.',
                        kayitId,puanGonderildi:false});
                    return;
                }
            }
            const kayit = {
                ...kayitTemel,
                createdAt: onceki?.createdAt || firebase.database.ServerValue.TIMESTAMP,
                updatedAt: firebase.database.ServerValue.TIMESTAMP,
                queuedOffline: false
            };
            // Ağda kayıt öncesi son ortak süre denetimi: gönderim tıklaması geç kalmışsa yazma.
            const sonTimerSnap=await db.ref(`maclar/${secimler.kategori}/${mac.id}/konusmaSayaclari/${ortakSureKimligi(secimler.okul,(secimler.ogr||'').split(' (')[0])}`).once('value');
            const sonTimer=sonTimerSnap.val();
            if(!sonTimer || !Number(sonTimer.baslangicAt)){
                const neden='Ortak süre bilgisi doğrulanamadı. Girilen 13 kriter resmî puana eklenmeden yönetici incelemesi için arşivleniyor.';
                puanKuyrukItem.queueStatus='sure_engeli_arsiv_bekliyor';
                puanKuyrukItem.officialSendAllowed=false;
                puanKuyrukItem.reddedilmeNedeni=neden;
                puanKuyrukDurumunuGuncelle(secimler.kategori,kayitId,{
                    queueStatus:'sure_engeli_arsiv_bekliyor',officialSendAllowed:false,reddedilmeNedeni:neden
                });
                try{
                    await puanReddedilenKaydiniArsivle(puanKuyrukItem,neden,'puan_sure_dogrulama_bekliyor_arsivlendi');
                    puanKuyrugundanSil(secimler.kategori,kayitId);
                }catch(arsivErr){
                    puanKuyrukDurumunuGuncelle(secimler.kategori,kayitId,{lastError:String(arsivErr?.message||arsivErr)});
                }
                await juriSureOturumLogunuGuncelle({durum:'puan_sure_dogrulama_bekliyor',hata:neden,
                    puanVerisi:{...kayitTemel.puanlar},kayitId,puanGonderildi:false,reddedilenPuanArsivlendi:true})
                    .catch(e=>console.warn('Süre doğrulama günlüğü yazılamadı:',e));
                alert('13 kriter kaybolmadı. Süre doğrulanamadığı için arşive alındı; yönetici geçmiş kayıttan inceleyebilir.');
                return;
            }
            if(!ortakPuanPenceresiAcik(sonTimer,puanGondermeAni)){
                aktifOrtakSureVerisi=sonTimer||aktifOrtakSureVerisi;ortakSureGoster();
                await juriSureOlayiYaz(juriSureDenetimTemeli({islem:'puan_gonderme',durum:'engellendi_son_kontrol',
                    hata:'Firebase üzerindeki son süre kontrolünde ortak sayaç bitişinden sonraki 1 dakikalık sınır aşılmış.',
                    sifirlamaSecenegiSunuldu:true,sifirlamaTalepEdildi:false,sifirlamaKullanildi:false,
                    izinVerilenEkSureSaniye:ORTAK_PUAN_EK_SURE})).catch(e=>console.warn('Son kontrol günlüğü yazılamadı:',e));
                await juriSureOturumLogunuGuncelle({durum:'puan_gonderme_engellendi_sure_asimi',puanGonderildi:false,
                    puanGondermeEngelNedeni:'Firebase son kontrolünde 1 dakikalık pencere doldu.'});
                const sureNedeni='Firebase üzerindeki son kontrol, ortak puanlama penceresinin dolduğunu gösterdi. Puan resmî tabloya alınmadı.';
                try{
                    puanKuyrukDurumunuGuncelle(secimler.kategori,kayitId,{queueStatus:'sure_engeli_arsiv_bekliyor',
                        officialSendAllowed:false,reddedilmeNedeni:sureNedeni});
                    puanKuyrukItem.queueStatus='sure_engeli_arsiv_bekliyor';puanKuyrukItem.officialSendAllowed=false;
                    puanKuyrukItem.reddedilmeNedeni=sureNedeni;
                    await puanReddedilenKaydiniArsivle(puanKuyrukItem,sureNedeni,'puan_sure_engeli_arsivlendi');
                    puanKuyrugundanSil(secimler.kategori,kayitId);
                    await juriSureOturumLogunuGuncelle({durum:'puan_sure_engeli_arsivlendi',hata:sureNedeni,
                        puanVerisi:{...kayitTemel.puanlar},kayitId,puanGonderildi:false,reddedilenPuanArsivlendi:true});
                    alert('Puanlama süresi dolduğu için resmî puan kaydı yapılmadı. Girilen kriterler yönetici incelemesi için arşivlendi. Gerekliyse süre sıfırlamasıyla yeniden puanlayın.');
                }catch(arsivErr){
                    puanKuyrukDurumunuGuncelle(secimler.kategori,kayitId,{queueStatus:'sure_engeli_arsiv_bekliyor',
                        officialSendAllowed:false,reddedilmeNedeni:sureNedeni,lastError:String(arsivErr?.message||arsivErr)});
                    await juriSureOturumLogunuGuncelle({durum:'puan_sure_engeli_arsiv_hatasi',hata:String(arsivErr?.message||arsivErr),
                        puanVerisi:{...kayitTemel.puanlar},kayitId,puanGonderildi:false});
                    alert('Puanlama süresi dolduğu için resmî kayda eklenmedi. Arşiv aktarımı tamamlanamadı; 13 kriter kuyrukta korundu.');
                }
                return;
            }
            aktifOrtakSureVerisi=sonTimer;
            // Doğrudan yalnızca bu jüriye ait kaydı yaz. Başka jürilerin kayıtları ve sayaç
            // bu işlem tarafından hiçbir zaman güncellenmez.
            firebaseYazmaDenendi=true;
            await puanKayitRef.set(kayit);
            const puanDogrulama=await firebasePuanKaydiniDogrula(puanKayitRef,kayit);
            if(!puanDogrulama.ok)throw new Error('Firebase yazımından sonra puan kaydı geri okundu ancak jüri/öğrenci/13 kriter doğrulaması eşleşmedi. Puan gönderildi kabul edilmedi.');
            firebaseKaydiDogrulandi=true;
            puanKuyrugundanSil(secimler.kategori,kayitId);
            puanFirebaseDurumuYaz('success',`✓ ${oturum.juri} · ${secimler.ogr}: 13/13 kriter Firebase’den geri okunarak doğrulandı.`,{
                kayitId,macId:mac.id,ogr:secimler.ogr,juri:oturum.juri
            });
            const puanYedekYolu=`arsiv/juriPuanYedekleri/${secimler.kategori}/${mac.id}/${kayitId}`;
            try{
                await db.ref(puanYedekYolu+'/sonDurum').set({...kayit,yedekAt:firebase.database.ServerValue.TIMESTAMP});
                await db.ref(puanYedekYolu+'/gecmis/'+String(yerelZaman)).set({...kayit,yedekAt:firebase.database.ServerValue.TIMESTAMP,yedekOlayi:onceki?'juri_puani_guncellendi':'juri_puani_ilk_kayit'});
            }catch(yedekErr){console.warn('Resmî puan kaydedildi ancak bağımsız arşiv yedeği yazılamadı:',yedekErr);}
            await puanTaslaginiSil(aktifPuanTaslak);
            eskiJuriPuanMukerrerleriniTemizle(secimler.kategori,kayitId,kayitId);
            await juriSureOturumLogunuGuncelle({durum:'puanlar_gonderildi',puanGonderildi:true,
                puanGonderildiAt:firebase.database.ServerValue.TIMESTAMP,puanGondermeAniClient:puanGondermeAni,
                kaydedilenKayitId:kayitId}).catch(logErr=>{
                    console.warn('Puan Firebase’de doğrulandı ancak jüri işlem günlüğü yazılamadı:',logErr);
                    puanFirebaseDurumuYaz('warning','✓ Puan Firebase’de doğrulandı. ⚠ Jüri işlem günlüğü yazılamadı; puanın kendisi kaydedilmiş durumda.',{
                        kayitId,macId:mac.id,ogr:secimler.ogr,juri:oturum.juri
                    });
                });
            alert(onceki ? '✓ Güncellenen puan Firebase’den geri okunarak doğrulandı.' : '✓ Puanlar Firebase’e kaydedildi ve geri okunarak doğrulandı.');
            // Turnuva ağacını yansıtma ikincil işlemdir; başarısızlığı kaydedilmiş puanı geri almış gibi göstermez.
            try{await turnuvaAgacinaPuanYansit(secimler.kategori, mac.hukOkul, mac.muhOkul);}
            catch(agacErr){console.warn('Puan kaydedildi ancak turnuva ağacı güncellenemedi:',agacErr);}
            secimler.ogr = '';
            secimleriKaydet();
            renderPuanlamaSecim(mac.id);
        } catch (err) {
            console.error('Puan gönderme hatası:', err);
            const code=String(err?.code||'').toLowerCase();
            // set() hata döndürmüş olsa bile sunucu yazımı almış olabilir; kuyruğa almadan önce oku.
            if(firebaseYazmaDenendi&&!firebaseKaydiDogrulandi&&puanKayitRef){
                try{
                    const tekrar=await firebasePuanKaydiniDogrula(puanKayitRef,kayitTemel);
                    if(tekrar.ok)firebaseKaydiDogrulandi=true;
                }catch(readErr){console.warn('Belirsiz Firebase yazımı geri okunamadı:',readErr);}
            }
            if(firebaseKaydiDogrulandi){
                puanFirebaseDurumuYaz('success',`✓ ${oturum.juri} · ${secimler.ogr}: puan Firebase’den geri okunarak doğrulandı. Sonraki yardımcı işlemde hata oluştu; puan kaydı korunuyor.`,{
                    kayitId,macId:mac.id,ogr:secimler.ogr,juri:oturum.juri
                });
                try{await puanTaslaginiSil(aktifPuanTaslak);}catch(cleanErr){console.warn('Kaydedilmiş puanın taslağı temizlenemedi:',cleanErr);}
                alert('Puan Firebase’de bulundu ve 13 kriter doğrulandı. Sonraki yardımcı işlemde hata oluştu; puan kaydı kaybolmadı.');
                secimler.ogr='';
                secimleriKaydet();
                renderPuanlamaSecim(mac.id);
            }else if(code.includes('permission')){
                puanKuyrukDurumunuGuncelle(secimler.kategori,kayitId,{queueStatus:'yetki_hatasi',lastError:String(err?.message||err)});
                await juriSureOturumLogunuGuncelle({durum:'puan_kayit_yetki_hatasi',
                    hata:'Firebase erişim yetkisi puan kaydını reddetti. Puan yerel gönderim kuyruğunda korundu.',
                    firebaseHatasiKodu:code,puanVerisi:{...kayitTemel.puanlar},puanGonderildi:false,
                    puanKuyrugaAlindi:true,kayitId});
                puanFirebaseDurumuYaz('error','⛔ Firebase puan yazımına izin vermedi. Puan gönderilmedi; 13 kriterli taslak bu cihazda korundu. Yetki sorunu çözülmeden bu kaydı gönderildi kabul etmeyin.',{
                    kayitId,macId:mac.id,ogr:secimler.ogr,juri:oturum.juri
                });
                await juriSureOturumLogunuGuncelle({durum:'puan_kayit_yetki_hatasi',hata:'Firebase erişim yetkisi puan kaydını reddetti. Puan Firebase’e kaydedilemedi.',firebaseHatasiKodu:code,puanGonderildi:false,kayitId}).catch(logErr=>console.warn('Yetki hatası yönetici günlüğüne yazılamadı:',logErr));
                alert('Firebase erişim yetkisi puan kaydını reddetti. Puan Firebase’e kaydedilmedi. Taslak bu ekranda ve cihazda korunuyor; yönetici günlüğüne hata bildirildi.');
            }else{
                try{
                    puanKuyrukDurumunuGuncelle(secimler.kategori,kayitId,{queueStatus:'dogrulama_bekliyor',
                        kayit:{...kayitTemel,createdAt:yerelZaman,updatedAt:yerelZaman,queuedOffline:true},lastError:String(err?.message||err)});
                    await juriSureOturumLogunuGuncelle({durum:'puanlar_kuyruga_alindi_hata',puanGonderildi:false,puanKuyrugaAlindi:true,
                        puanVerisi:{...kayitTemel.puanlar},kayitId,puanKuyrukHatasi:String(err?.message||err),puanGondermeAniClient:puanGondermeAni}).catch(logErr=>console.warn('Kuyruk günlüğü yazılamadı:',logErr));
                    puanFirebaseDurumuYaz('queued','⚠ Firebase kaydı geri okunarak doğrulanamadı. Puan bu cihazın kuyruğunda korundu; gönderildi kabul edilmedi. Bağlantı gelince yeniden denenecek.',{
                        kayitId,macId:mac.id,ogr:secimler.ogr,juri:oturum.juri
                    });
                    alert('Puan Firebase’de doğrulanamadı. 13 kriter yerel gönderim kuyruğunda ve taslakta korundu; gönderildi kabul edilmedi. İnternet geldiğinde yeniden denenecek.');
                }catch(queueErr){
                    console.error('Yerel puan kuyruğu da yazılamadı:',queueErr);
                    puanFirebaseDurumuYaz('error','⛔ Firebase kaydı doğrulanamadı ve yerel kuyruk da yazılamadı. Puanlama ekranını kapatmayın; seçili 13 kriter hâlâ ekranda. Bağlantı/yetki kontrolü yapın.',{
                        kayitId,macId:mac.id,ogr:secimler.ogr,juri:oturum.juri
                    });
                    await juriSureOturumLogunuGuncelle({durum:'puan_kayit_hatasi',hata:'Firebase kaydı doğrulanamadı ve yerel gönderim kuyruğu da yazılamadı: '+String(queueErr?.message||queueErr),puanGonderildi:false,kayitId}).catch(logErr=>console.warn('Kritik kayıt hatası yönetici günlüğüne yazılamadı:',logErr));
                    alert('Puan Firebase’de doğrulanamadı ve yerel kuyruk yazılamadı. Ekranı kapatmayın; seçilen puanlar hâlâ formda. Hata yönetici günlüğüne bildirildi.');
                }
                // Hata durumunda öğrenci seçimini ve formu temizleme; jüri aynı puanları görebilsin.
            }
        } finally {
            puanGonderiliyor = false;
            const yeniBtn = document.getElementById('btnPuanGonder');
            if (yeniBtn) { yeniBtn.innerText = 'Puanları Gönder ✓'; ortakPuanArayuzunuGuncelle(); }
        }
    }

    