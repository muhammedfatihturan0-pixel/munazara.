
    const APP_VERSION = '3.38 · Bildirim Merkezi ve Jüri Puan Takibi';
    const krit = [
        {t:"Argüman Mantıklı ve Tutarlı mı?", m:5}, {t:"Argümanlar Örneklerle Destekleniyor mu?", m:5}, {t:"Argümanın Güncel ve Bilimsel Verilere Dayanıyor mu?", m:5},
        {t:"Ses Tonu ve Vurgu", m:10}, {t:"Jest ve Mimiklerin Etkin Kullanımı", m:10}, {t:"Göz Teması ve Konuşma Hızı", m:5},
        {t:"Materyal Kullanımı", m:5}, {t:"Karşıt Görüşe Cevap Verebilme", m:10}, {t:"Saygılı ve Etkin Üslup Kullanımı", m:10},
        {t:"Tartışmanın Farklı ve Derin Bir Biçimde Ele Alınması", m:10}, {t:"Konuşma Süresini Etkin Kullanabiliyor mu?", m:10},
        {t:"Konuşma İyi Planlanmış mı?", m:10}, {t:"Konuşma Esnasında Konu Bütünlüğü Sağlanıyor mu?", m:5}
    ];

    const BEKLENEN_JURILER = ['1. Jüri', '2. Jüri', '3. Jüri'];
    const kSifre = "MTk5Mg==";
    const JURI_OTURUM_KEY = 'munazaraJuriOturumuV3';
    const OFFLINE_QUEUE_KEY = 'munazaraOfflineQueueV3';
    const CLIENT_ID_KEY = 'munazaraClientIdV1';
    const TURN_CACHE_PREFIX = 'turnuvaCacheV3_';

    let aktifMacSecimleri = JSON.parse(localStorage.getItem('aktifMacSecimleri')) || {
        kategori: 'ORTAOKUL', hukOkul: '', muhOkul: '', taraf: '', juri: '', juriAd: '', ogr: '', okul: '', macId: ''
    };
    let secimler = { ...aktifMacSecimleri };
    let verilenPuanlar = {};
    let puanGonderiliyor = false;
    let sonRaporVerisi = null;
    let firebaseBagli = false;
    let aktifJuriListenerRef = null;
    let aktifJuriMacListenerRef = null;
    let aktifCanliPanelRefs = [];
    let aktifTurnuvaRef = null;

    function puanMetniNormalize(v) {
        return String(v ?? '').normalize('NFC').trim();
    }

    function htmlEscape(v) {
        return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
    }

    function hash32(str, seed=2166136261) {
        let h = seed >>> 0;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(16).padStart(8, '0');
    }

    function getClientId() {
        let id = localStorage.getItem(CLIENT_ID_KEY);
        if (!id) {
            id = 'c_' + hash32(String(Date.now()) + '|' + Math.random(), 2166136261) + hash32(navigator.userAgent || '', 3339675911);
            localStorage.setItem(CLIENT_ID_KEY, id);
        }
        return id;
    }

    function macEtiketi(hukOkul, muhOkul) {
        return `${puanMetniNormalize(hukOkul)} VS ${puanMetniNormalize(muhOkul)}`;
    }

    function macKimligiOlustur(kategori, hukOkul, muhOkul) {
        const temel = [kategori, hukOkul, muhOkul].map(puanMetniNormalize).join('|').toLocaleLowerCase('tr-TR');
        return 'm_' + hash32(temel, 2166136261) + hash32(temel, 3339675911);
    }

    function macEskiEtiketi(hukOkul, muhOkul) {
        return `${hukOkul}-vs-${muhOkul}`;
    }

    function kayitMacId(v) {
        if (v?.macId) return v.macId;
        const s = v?.secim || {};
        if (s.hukOkul && s.muhOkul) return macKimligiOlustur(s.kategori || v.kategori || '', s.hukOkul, s.muhOkul);
        if (v?.mac) return 'legacy_' + hash32(String(v.mac).toLocaleLowerCase('tr-TR'));
        return 'legacy_genel';
    }

    // Eski puanlarda macId eski/yanlış kalmış olsa bile yalnızca aynı kategori ve
    // aynı iki okulun eşleşmesi doğrulanırsa bu maça bağla. Farklı maça puan taşımaz.
    function puanKaydiBuMacaAitMi(v,macId,m,kategori){
        if(kayitMacId(v)===macId)return true;
        const s=v?.secim||{};
        const kayitKategori=String(s.kategori||v.kategori||'').toLocaleUpperCase('tr-TR');
        const hedefKategori=String(kategori||m?.kategori||secimler.kategori||'').toLocaleUpperCase('tr-TR');
        if(!kayitKategori||!hedefKategori||kayitKategori!==hedefKategori)return false;
        if(!s.hukOkul||!s.muhOkul||!m?.hukOkul||!m?.muhOkul)return false;
        return okulCiftiEslesiyor(s.hukOkul,s.muhOkul,m.hukOkul,m.muhOkul);
    }

    // Tarafı okul adına göre çöz; okul adı yoksa kayıtlı takım sırasını kullan.
    // Eski kaydın Hükümet/Muhalefet sırası ters olsa bile puan yanlış takıma yazılmaz.
    function puanKaydiTarafiniBul(v,m){
        const s=v?.secim||{};
        const okul=skorEslesmeAnahtari(s.okul);
        const h=new Set([m?.hukOkul,m?.ogrenciKaynaklari?.huk].map(skorEslesmeAnahtari).filter(Boolean));
        const u=new Set([m?.muhOkul,m?.ogrenciKaynaklari?.muh].map(skorEslesmeAnahtari).filter(Boolean));
        const hMi=!!okul&&h.has(okul),uMi=!!okul&&u.has(okul);
        if(hMi!==uMi)return hMi?'huk':'muh';
        const recorded=s.taraf==='HÜKÜMET'?'huk':s.taraf==='MUHALEFET'?'muh':'';
        if(!recorded)return '';
        const sh=skorEslesmeAnahtari(s.hukOkul),sm=skorEslesmeAnahtari(s.muhOkul);
        const th=skorEslesmeAnahtari(m?.hukOkul),tm=skorEslesmeAnahtari(m?.muhOkul);
        if(sh&&sm&&th&&tm){
            if(sh===th&&sm===tm)return recorded;
            if(sh===tm&&sm===th)return recorded==='huk'?'muh':'huk';
        }
        return recorded;
    }

    function kayitMacEtiketi(v) {
        if (v?.macEtiketi) return v.macEtiketi;
        const s = v?.secim || {};
        if (s.hukOkul && s.muhOkul) return macEtiketi(s.hukOkul, s.muhOkul);
        return String(v?.mac || 'Genel').replace('-vs-', ' VS ');
    }

    function puanKayitKimligi(secimObj, macId) {
        const s = secimObj || {};
        const temel = [
            s.kategori, macId, s.okul, s.ogr, s.juri, s.taraf
        ].map(puanMetniNormalize).join('|').toLocaleLowerCase('tr-TR');
        return 'p_' + hash32(temel, 2166136261) + hash32(temel, 3339675911);
    }

    // Eski rastgele anahtarlı mükerrer puan kayıtları yalnızca ana puan başarıyla
    // kaydedildikten sonra arka planda temizlenir; bu işlem başka jüri kayıtlarını etkilemez.
    function eskiJuriPuanMukerrerleriniTemizle(kategori,kayitId,kanonikAnahtar){
        void db.ref(`puanlar/${kategori}`).once('value').then(snapshot=>{
            const silinecek=[];
            snapshot.forEach(c=>{
                if(c.key===kanonikAnahtar)return;
                const v=c.val();
                if(!v||!v.secim||!v.puanlar)return;
                if(puanKayitKimligi(v.secim,kayitMacId(v))===kayitId)
                    silinecek.push(db.ref(`puanlar/${kategori}/${c.key}`).remove());
            });
            return Promise.allSettled(silinecek);
        }).catch(err=>console.warn('Eski mükerrer puanları arka planda temizleme başarısız:',err));
    }

    function puanToplami(v) {
        const p = (v && v.puanlar) || {};
        return krit.reduce((toplam, _k, i) => toplam + Number(p[i] ?? p[String(i)] ?? 0), 0);
    }

    function snapshotKayitlariniTekillestir(snapshot) {
        const map = new Map();
        if (!snapshot) return [];
        snapshot.forEach(c => {
            const v = c.val();
            if (!v || !v.secim || !v.puanlar) return;
            const mid = kayitMacId(v);
            const dogalId = puanKayitKimligi(v.secim, mid);
            map.set(dogalId, { ...v, macId: mid, macEtiketi: kayitMacEtiketi(v), _firebaseKey: c.key, _dogalId: dogalId });
        });
        return Array.from(map.values());
    }

    function ogrenciGrupKimligi(v) {
        const s = v.secim || {};
        return [kayitMacId(v), s.okul || '', (s.ogr || '').split(' (')[0]].map(puanMetniNormalize).join('|');
    }

    function secimleriKaydet() {
        localStorage.setItem('aktifMacSecimleri', JSON.stringify(secimler));
    }

    // Puan taslakları jüri koltuğu + öğrenci bazında ayrıdır; her seçim önce cihazda,
    // bağlantı varsa ayrıca Firebase'de saklanır. Resmî puan kaydı oluşmadan silinmez.
    const PUAN_TASLAK_KEY_PREFIX='munazaraPuanTaslakV1_';
    let aktifPuanTaslak=null;
    function puanTaslakBaglamiOlustur(mac,oturum){
        const secim={...secimler,macId:mac.id,juri:oturum.juri,juriAd:oturum.ad};
        const kayitId=puanKayitKimligi(secim,mac.id);
        return {
            kategori:secimler.kategori,macId:mac.id,kayitId,secim,
            localKey:PUAN_TASLAK_KEY_PREFIX+secimler.kategori+'_'+mac.id+'_'+kayitId,
            cloudPath:`puanTaslaklari/${secimler.kategori}/${mac.id}/${kayitId}`
        };
    }
    function puanTaslakVerisiOlustur(ctx){
        return {secim:ctx.secim,macId:ctx.macId,puanlar:{...verilenPuanlar},
            clientId:getClientId(),localUpdatedAt:Date.now(),durum:'taslak'};
    }
    function puanTaslaginiKaydet(){
        const ctx=aktifPuanTaslak;if(!ctx)return;
        const veri=puanTaslakVerisiOlustur(ctx);
        try{localStorage.setItem(ctx.localKey,JSON.stringify(veri));}
        catch(err){console.warn('Puan taslağı cihazda saklanamadı:',err);}
        const durum=document.getElementById('puanTaslakDurumu');
        if(durum)durum.textContent='Taslak cihazda kaydedildi; Firebase yedeği kontrol ediliyor…';
        if(navigator.onLine&&firebaseBagli){
            db.ref(ctx.cloudPath).transaction(cur=>{
                const tamamlandiAt=Number(cur?.tamamlandiAt||0);
                if(cur?.durum==='gonderildi'&&tamamlandiAt>=Number(veri.localUpdatedAt||0))return cur;
                if(Number(cur?.localUpdatedAt||0)>Number(veri.localUpdatedAt||0))return cur;
                return {...veri,updatedAt:firebase.database.ServerValue.TIMESTAMP};
            },undefined,false).then(result=>{
                if(aktifPuanTaslak===ctx&&document.getElementById('puanTaslakDurumu'))
                    document.getElementById('puanTaslakDurumu').textContent=result.committed
                        ?'✓ Taslak cihazda ve Firebase’de otomatik kaydedildi.':'✓ Daha yeni bir taslak veya gönderim kaydı korundu.';
            }).catch(err=>{
                console.warn('Firebase puan taslağı yedeklenemedi:',err);
                if(aktifPuanTaslak===ctx&&document.getElementById('puanTaslakDurumu'))
                    document.getElementById('puanTaslakDurumu').textContent='⚠ Taslak bu cihazda saklandı; Firebase yedeği yazılamadı.';
            });
        }else if(durum)durum.textContent='⚠ Taslak bu cihazda saklandı; bağlantı gelince bulut yedeği alınacak.';
    }
    async function puanTaslaginiGeriYukle(ctx){
        if(!ctx)return;
        let veri=null,kaynak='cihaz';
        try{veri=JSON.parse(localStorage.getItem(ctx.localKey)||'null');}catch(_){}
        if(navigator.onLine&&firebaseBagli){
            try{
                const snap=await db.ref(ctx.cloudPath).once('value');
                const bulut=snap.val();
                const yerelAt=Number(veri?.localUpdatedAt||0);
                if(bulut?.durum==='gonderildi'&&Number(bulut.tamamlandiAt||0)>=yerelAt){
                    try{localStorage.removeItem(ctx.localKey);}catch(_){}
                    veri=null;
                }else if(bulut&&bulut.puanlar&&(!veri||Number(bulut.localUpdatedAt||0)>=yerelAt)){
                    veri=bulut;kaynak='Firebase';
                }
            }catch(err){console.warn('Bulut puan taslağı okunamadı:',err);}
        }
        if(aktifPuanTaslak!==ctx||!document.getElementById('kriterListesi'))return;
        if(Object.keys(verilenPuanlar||{}).length)return; // Okuma sürerken yapılan yeni seçimleri ezme.
        const restored={};
        for(let i=0;i<krit.length;i++){
            const p=Number(veri?.puanlar?.[i]??veri?.puanlar?.[String(i)]);
            if(Number.isInteger(p)&&p>=1&&p<=krit[i].m)restored[i]=p;
        }
        if(!Object.keys(restored).length){
            const d=document.getElementById('puanTaslakDurumu');
            if(d)d.textContent='Taslak yedekleme hazır: her kriter seçimi otomatik saklanır.';
            return;
        }
        verilenPuanlar=restored;
        document.querySelectorAll('#kriterListesi .kriter-card').forEach((kart,i)=>{
            const secili=restored[i];
            if(!secili)return;
            kart.querySelectorAll('.puan-btn').forEach(btn=>{
                if(Number(btn.textContent.trim())===secili)btn.classList.add('selected');
            });
        });
        try{localStorage.setItem(ctx.localKey,JSON.stringify(veri));}catch(_){}
        const d=document.getElementById('puanTaslakDurumu');
        if(d)d.textContent=`↩ ${Object.keys(restored).length}/13 kriter ${kaynak} yedeğinden geri yüklendi.`;
    }
    async function puanTaslaginiSil(ctx){
        if(!ctx)return;
        try{localStorage.removeItem(ctx.localKey);}catch(_){}
        if(navigator.onLine&&firebaseBagli){
            try{
                await db.ref(ctx.cloudPath).transaction(cur=>{
                    if(!cur)return cur;
                    if(cur.durum==='gonderildi')return cur;
                    const now=Date.now();
                    return {...cur,durum:'gonderildi',tamamlandiAt:now,
                        tamamlananLocalUpdatedAt:Number(cur.localUpdatedAt||0)};
                },undefined,false);
            }catch(err){console.warn('Tamamlanan puan taslağı bulutta işaretlenemedi:',err);}
        }
    }

    function LogSifre(metin) {
        return btoa(metin);
    }

    function adminSifreDogrula(mesaj='Yetkili şifresini giriniz:') {
        const girdi = prompt(mesaj);
        if (girdi === null) return false;
        if (LogSifre(girdi.trim()) !== kSifre) {
            alert('Hatalı şifre! Erişim reddedildi.');
            return false;
        }
        sessionStorage.setItem('adminGiris', 'onayli');
        return true;
    }

    function adminYetkiliMi() {
        return sessionStorage.getItem('adminGiris') === 'onayli';
    }

    function juriOturumuGetir() {
        try { return JSON.parse(localStorage.getItem(JURI_OTURUM_KEY) || 'null'); } catch (_) { return null; }
    }

    async function juriOturumuKilitle(juri, ad) {
        const mac = puanlamaMaclar.get(secimler.macId);
        const baglam = juriSecimBaglami(mac);
        if (!baglam) return alert('Önce tarihi belli bir maç seçin. Günün jüri isimleri maç seçildikten sonra gösterilir.');
        const rolAnahtari = ({'1. Jüri':'asil1','2. Jüri':'asil2','3. Jüri':'asil3'})[juri];
        const temizAd = puanMetniNormalize(ad);
        if (!rolAnahtari || !temizAd) return alert('Günün üç asıl jüri listesinden kendi adınızı seçin.');
        // Asıl jüri girişinde yalnızca aynı gün/kategori için resmî görevlendirilen isim kabul edilir.
        try {
            const snap = await db.ref(`fikstur/tekSalon_2026_2027/juries/${baglam.gunKey}/${baglam.kategori}`).once('value');
            const gorevli = snap.val() || {};
            const resmiAd = puanMetniNormalize(gorevli[rolAnahtari]?.name || '');
            if (!resmiAd || resmiAd !== temizAd) {
                alert('Günün jüri görevlendirmesi değişmiş veya okunamamış. Güncel isimler yeniden yüklenecek; listeden tekrar seçin.');
                void juriPaneliniGuncelle(mac);
                return;
            }
        } catch (err) {
            alert('Günün jüri görevlendirmesi doğrulanamadı. İnternet bağlantısını kontrol edip tekrar deneyin.');
            return;
        }
        const oturum = { juri, ad: temizAd, yedekMi:false, gunKey: baglam.gunKey, gunLabel: baglam.gunLabel,
            kategori: baglam.kategori, lockedAt: Date.now(), clientId: getClientId() };
        localStorage.setItem(JURI_OTURUM_KEY, JSON.stringify(oturum));
        secimler.juri = juri;
        secimler.juriAd = temizAd;
        secimleriKaydet();
        renderPuanlamaSecim();
        if(typeof sonucDuyuruGoster==='function')sonucDuyuruGoster();
    }

    // Yedek jüri adı ilk ekranda listelenmez. Yalnızca kullanıcı değişim düğmesine
    // bastıktan sonra yedek bilgisi gösterilir ve yerine geçeceği jüri koltuğu seçilir.
    async function yedekJuriOturumuAc(juri) {
        const mac = puanlamaMaclar.get(secimler.macId);
        const baglam = juriSecimBaglami(mac);
        const rolAnahtari = ({'1. Jüri':'asil1','2. Jüri':'asil2','3. Jüri':'asil3'})[juri];
        if (!baglam) return alert('Önce tarihi belli bir maç seçin.');
        if (!rolAnahtari) return alert('Geçerli bir jüri koltuğu seçin.');
        let yedekAd = '', asilAd = '';
        try {
            const snap = await db.ref(`fikstur/tekSalon_2026_2027/juries/${baglam.gunKey}/${baglam.kategori}`).once('value');
            const roster = snap.val() || {};
            yedekAd = puanMetniNormalize(roster.yedek?.name || '');
            asilAd = puanMetniNormalize(roster[rolAnahtari]?.name || '');
        } catch (err) {
            return alert('Yedek jüri görevlendirmesi doğrulanamadı. İnternet bağlantısını kontrol edip tekrar deneyin.');
        }
        if (!yedekAd || /^(protokol|belirlenecek|[-—]+)$/i.test(yedekAd))
            return alert('Bu gün ve kategori için kullanılabilir bir yedek jüri görevlendirmesi bulunamadı.');
        const soru = `${yedekAd}, ${juri} (${asilAd || 'asıl jüri'}) koltuğunun yerine görevlendirilecek.\n\nBu değişikliği bu cihazdaki jüri oturumu için uygulayalım mı?`;
        if (!confirm(soru)) return;
        // Puan kaydında 1./2./3. jüri rolü korunur; yedek kişi seçilen koltuğa vekâleten puan girer.
        const oturum = {
            juri, ad: yedekAd, yedekMi:true, yedekYerine:juri, asilinAdi:asilAd,
            gunKey:baglam.gunKey, gunLabel:baglam.gunLabel, kategori:baglam.kategori,
            lockedAt:Date.now(), clientId:getClientId()
        };
        localStorage.setItem(JURI_OTURUM_KEY, JSON.stringify(oturum));
        secimler.juri = juri;
        secimler.juriAd = yedekAd;
        secimleriKaydet();
        renderPuanlamaSecim();
        if(typeof sonucDuyuruGoster==='function')sonucDuyuruGoster();
    }

    async function yedekJuriDegisimPaneliniAc() {
        const panel = document.getElementById('juriOturumPanel');
        if (!panel) return;
        const onceki = document.getElementById('yedekJuriDegisimAlan');
        if (onceki) { onceki.remove(); return; }
        const mac = puanlamaMaclar.get(secimler.macId);
        const baglam = juriSecimBaglami(mac);
        if (!baglam) return alert('Önce tarihi belli bir maç seçin. Yedek jüri o gün ve kategoriye göre getirilir.');

        const alan = document.createElement('div');
        alan.id = 'yedekJuriDegisimAlan';
        alan.style.cssText = 'margin-top:14px;padding:14px;background:#111c31;border:1px solid #a16207;border-radius:10px;';
        alan.innerHTML = '<div style="font-size:13px;font-weight:800;color:#fcd34d;margin-bottom:6px;">Yedek jüriyle değiştir</div>' +
            '<div style="font-size:12px;color:#cbd5e1;line-height:1.5;margin-bottom:10px;">Yedek jüri yalnızca seçtiğiniz asıl jüri koltuğunun yerine geçer. Normal jüri listesine eklenmez.</div>' +
            '<div id="yedekJuriBilgi" style="font-size:13px;color:#f8fafc;">Günün yedek jüri görevlendirmesi yükleniyor…</div>';
        panel.appendChild(alan);
        try {
            const snap = await db.ref(`fikstur/tekSalon_2026_2027/juries/${baglam.gunKey}/${baglam.kategori}`).once('value');
            if (!document.getElementById('yedekJuriDegisimAlan')) return;
            const roster = snap.val() || {};
            const yedek = roster.yedek || {};
            const yedekAd = puanMetniNormalize(yedek.name || '');
            const bilgi = document.getElementById('yedekJuriBilgi');
            if (!yedekAd || /^(protokol|belirlenecek|[-—]+)$/i.test(yedekAd)) {
                bilgi.textContent = 'Bu gün ve kategori için kullanılabilir bir yedek jüri görevlendirmesi yok.';
                bilgi.style.color = '#fed7aa';
                return;
            }
            bilgi.textContent = `${yedekAd}${yedek.school && yedek.school !== '-' ? ' · '+yedek.school : ''}`;
            const etiket = document.createElement('label');
            etiket.htmlFor = 'yedekJuriKoltukSec';
            etiket.style.cssText = 'display:block;margin-top:12px;font-size:12px;color:#cbd5e1;';
            etiket.textContent = 'Hangi jüri koltuğunun yerine geçecek?';
            const select = document.createElement('select');
            select.id = 'yedekJuriKoltukSec';
            select.style.marginTop = '5px';
            const roller = [['1. Jüri','asil1'],['2. Jüri','asil2'],['3. Jüri','asil3']];
            const oturum = juriOturumuGetir();
            for (const [rol, anahtar] of roller) {
                const kisi = roster[anahtar] || {};
                const isim = puanMetniNormalize(kisi.name || '');
                const opt = document.createElement('option');
                opt.value = rol;
                opt.textContent = `${rol}${isim && !/^(protokol|belirlenecek|[-—]+)$/i.test(isim) ? ' · '+isim : ''}`;
                if (oturum && oturum.juri === rol) opt.selected = true;
                select.appendChild(opt);
            }
            const uygula = document.createElement('button');
            uygula.className = 'btn';
            uygula.style.cssText = 'margin:10px 0 0;background:#92400e;border-color:#b45309;';
            uygula.textContent = 'Bu yedek jüriyle değiştir';
            uygula.onclick = () => { void yedekJuriOturumuAc(select.value); };
            alan.append(etiket, select, uygula);
        } catch (err) {
            const bilgi = document.getElementById('yedekJuriBilgi');
            if (bilgi) { bilgi.textContent = 'Yedek jüri listesi yüklenemedi. İnternet bağlantısını kontrol edip tekrar deneyin.'; bilgi.style.color = '#fed7aa'; }
        }
    }

    function juriOturumunuSifirla() {
        if (!confirm('Bu cihazdaki jüri oturumunu sıfırlamak istiyor musunuz? Girilmiş puanlar ve fikstür SİLİNMEYECEK; yalnızca bu cihazdaki jüri kilidi kaldırılacak.')) return;
        localStorage.removeItem(JURI_OTURUM_KEY);
        secimler.juri = '';
        secimler.juriAd = '';
        secimleriKaydet();
        renderPuanlamaSecim();
    }

    function offlineKuyrukGetir() {
        try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '{}') || {}; } catch (_) { return {}; }
    }

    const PUAN_FIREBASE_DURUM_KEY='munazaraPuanFirebaseDurumV1';
    let puanFirebaseAnlikDurum=null;
    function puanFirebaseDurumuOku(){
        try{return JSON.parse(localStorage.getItem(PUAN_FIREBASE_DURUM_KEY)||'null');}catch(_){return null;}
    }
    function puanFirebaseDurumuYaz(durum,mesaj,meta={}){
        const oturum=juriOturumuGetir();
        const kayit={durum,mesaj,kayitId:meta.kayitId||'',macId:meta.macId||'',ogr:meta.ogr||'',
            juri:meta.juri||oturum?.juri||'',juriAd:meta.juriAd||oturum?.ad||'',updatedAt:Date.now()};
        puanFirebaseAnlikDurum=kayit;
        try{
            localStorage.setItem(PUAN_FIREBASE_DURUM_KEY,JSON.stringify(kayit));
            puanBildirimKaydiniEkle(kayit);
        }catch(err){console.warn('Son puan gönderim/bildirim durumu cihazda saklanamadı:',err);}
        puanFirebaseDurumuGoster();
    }
    function puanFirebaseDurumunuTemizle(kayitId=''){
        try{const old=puanFirebaseDurumuOku();if(!kayitId||!old?.kayitId||old.kayitId===kayitId)localStorage.removeItem(PUAN_FIREBASE_DURUM_KEY);}catch(_){}
        if(!kayitId||puanFirebaseAnlikDurum?.kayitId===kayitId)puanFirebaseAnlikDurum=null;
        puanFirebaseDurumuGoster();
    }
    function puanDurumTarihiYaz(ts){
        const n=Number(ts||0);return n?new Date(n).toLocaleString('tr-TR'):'Tarih bilgisi yok';
    }
    function puanDurumOzetMetni(){
        const pending=Object.values(offlineKuyrukGetir()).filter(x=>x&&x.kayit);
        const durum=puanFirebaseAnlikDurum||puanFirebaseDurumuOku();
        if(pending.length){
            const problem=pending.some(x=>['yetki_hatasi','mac_kapali','mac_iptal','sure_engeli_arsiv_bekliyor'].includes(x.queueStatus)||x.lastError);
            return (problem?'Dikkat: ':'Bekleyen: ')+pending.length+' puan Firebase’de henüz doğrulanmadı.';
        }
        if(durum?.mesaj)return String(durum.mesaj)+' ('+puanDurumTarihiYaz(durum.updatedAt)+')';
        return 'Bu cihazda bekleyen puan yok. Henüz doğrulanmış bir gönderim bilgisi bulunmuyor.';
    }

    const PUAN_BILDIRIM_GECMISI_KEY='munazaraPuanBildirimGecmisiV1';
    const PUAN_BILDIRIM_OKUNDU_KEY='munazaraPuanBildirimOkunduAtV1';
    function puanBildirimGecmisiOku(){
        try{const v=JSON.parse(localStorage.getItem(PUAN_BILDIRIM_GECMISI_KEY)||'[]');return Array.isArray(v)?v:[];}
        catch(_){return [];}
    }
    function puanBildirimKaydiniEkle(kayit){
        const rows=puanBildirimGecmisiOku();
        const same=rows[0]&&rows[0].kayitId===kayit.kayitId&&rows[0].durum===kayit.durum&&rows[0].mesaj===kayit.mesaj;
        if(same&&Date.now()-Number(rows[0].updatedAt||0)<3000)return;
        rows.unshift({...kayit});
        localStorage.setItem(PUAN_BILDIRIM_GECMISI_KEY,JSON.stringify(rows.slice(0,25)));
    }
    function puanBildirimOkunmamisSayisi(){
        const readAt=Number(localStorage.getItem(PUAN_BILDIRIM_OKUNDU_KEY)||0);
        return puanBildirimGecmisiOku().filter(x=>Number(x.updatedAt||0)>readAt).length;
    }
    function bildirimMerkeziniAc(){
        const q=offlineKuyrukGetir();
        const pending=Object.entries(q).filter(([,x])=>x&&x.kayit);
        const durum=puanFirebaseAnlikDurum||puanFirebaseDurumuOku();
        const rows=puanBildirimGecmisiOku();
        try{localStorage.setItem(PUAN_BILDIRIM_OKUNDU_KEY,String(Date.now()));}catch(_){}
        const level=durum?.durum==='success'&&!pending.length?'success':(pending.length||durum?.durum==='error'?'warning':'neutral');
        const latest=durum?.mesaj
            ?'<article class="bildirim-item bildirim-'+htmlEscape(durum.durum||'neutral')+'"><div class="bildirim-item-head"><strong>Son işlem</strong><time>'+htmlEscape(puanDurumTarihiYaz(durum.updatedAt))+'</time></div>'+
                '<p>'+htmlEscape(durum.mesaj)+'</p>'+
                (durum.juri||durum.ogr?'<small>'+htmlEscape([durum.juri,durum.juriAd,durum.ogr].filter(Boolean).join(' · '))+'</small>':'')+'</article>'
            :'<div class="bildirim-empty">Bu cihazda henüz bir puan gönderim bildirimi oluşmadı.</div>';
        const queueHtml=pending.length?pending.map(([key,item])=>{
            const r=item.kayit||{},s=r.secim||{};
            const stamp=Number(item.puanGondermeAniClientAt||item.puanGondermeAni||item.queuedAt||r.localUpdatedAt||0);
            return '<article class="bildirim-item bildirim-warning"><div class="bildirim-item-head"><strong>'+htmlEscape(r.macEtiketi||r.mac||item.macId||'Maç bilgisi yok')+'</strong><span>'+htmlEscape(puanKuyrukDurumMetni(item))+'</span></div>'+
                '<p><b>Öğrenci:</b> '+htmlEscape(s.ogr||'—')+' · <b>Okul:</b> '+htmlEscape(s.okul||'—')+'</p>'+
                '<small>'+htmlEscape(item.kategori||'')+' · '+htmlEscape(s.juri||'Jüri bilgisi yok')+' · '+htmlEscape(puanDurumTarihiYaz(stamp))+'</small>'+
                (item.lastError||item.reddedilmeNedeni?'<p class="bildirim-error">'+htmlEscape(item.lastError||item.reddedilmeNedeni)+'</p>':'')+
                puanKriterDetayiHtml(r)+'</article>';
        }).join(''):'<div class="bildirim-empty">Bekleyen puan yok. Cihazın yerel gönderim kuyruğu boş.</div>';
        const historyHtml=rows.length?rows.slice(0,12).map(x=>
            '<article class="bildirim-history-row"><span class="bildirim-history-dot durum-'+htmlEscape(x.durum||'neutral')+'"></span><div><strong>'+htmlEscape(x.durum==='success'?'Puan doğrulandı':x.durum==='error'?'Gönderim hatası':x.durum==='queued'?'Puan kuyruğa alındı':'Puan gönderim durumu')+'</strong>'+
            '<p>'+htmlEscape(x.mesaj||'')+'</p><small>'+htmlEscape(puanDurumTarihiYaz(x.updatedAt))+(x.ogr?' · '+htmlEscape(x.ogr):'')+(x.juri?' · '+htmlEscape(x.juri):'')+'</small></div></article>'
        ).join(''):'<div class="bildirim-empty">Henüz bildirim geçmişi yok.</div>';
        const body='<section class="bildirim-summary bildirim-'+level+'"><span class="bildirim-summary-icon">'+(level==='success'?'✓':level==='warning'?'!':'i')+'</span><div><strong>'+(pending.length?pending.length+' puan bekliyor':durum?.durum==='success'?'Son gönderim doğrulandı':'Puan gönderim durumu')+'</strong><p>'+(pending.length?'Bu puanlar Firebase’den doğrulanana kadar resmî kaydedildi sayılmaz.':durum?.mesaj?htmlEscape(durum.mesaj):'Şu anda bekleyen puan bulunmuyor.')+'</p></div></section>'+
            '<div class="bildirim-section-head"><h3>Bekleyen puanlar</h3><span>'+pending.length+' kayıt</span></div>'+queueHtml+
            '<div class="bildirim-section-head"><h3>Son bildirimler</h3><span>Son '+Math.min(rows.length,12)+' kayıt</span></div>'+historyHtml+
            '<div class="bildirim-footer-actions"><button type="button" onclick="puanKuyrukDetayiniAc()">Kuyruk ve 13 kriteri ayrıntılı gör</button><button type="button" onclick="juriPuanGecmisiniAc()">Gönderdiğim puanların geçmişi</button></div>'+
            '<p class="bildirim-disclaimer">Bildirimler bu tablette saklanır. Uygulama kapalıyken telefon bildirimi gönderilmez; başka tabletlerin kuyrukları bu ekranda görünmez.</p>';
        puanGuvenceModaliniAc('Bildirim Merkezi',body);
        try{puanDurumPaneliniGuncelle();}catch(_){}
    }

    function puanDurumPaneliniKur(){
        if(!document.body)return null;
        let el=document.getElementById('puanGuvenceBar');
        if(!el){el=document.createElement('section');el.id='puanGuvenceBar';el.className='puan-guvence-bar';el.setAttribute('aria-live','polite');document.body.prepend(el);}
        return el;
    }
    function puanDurumPaneliniGuncelle(){
        const bar=puanDurumPaneliniKur();
        const pending=Object.values(offlineKuyrukGetir()).filter(x=>x&&x.kayit);
        const durum=puanFirebaseAnlikDurum||puanFirebaseDurumuOku();
        const online=navigator.onLine&&firebaseBagli;
        let level='neutral',title='Puan gönderim durumu',message='';
        if(pending.length){
            const problem=pending.some(x=>['yetki_hatasi','mac_kapali','mac_iptal','sure_engeli_arsiv_bekliyor'].includes(x.queueStatus)||x.lastError);
            level=problem?'error':'warning';title=problem?'İncelenmesi gereken puan var':'Gönderim kuyruğunda puan var';
            message=pending.length+' puan bu cihazda bekliyor; Firebase’den doğrulanmadan başarılı sayılmaz.';
        }else if(durum?.durum==='success'){
            level='success';title='Son puan gönderimi doğrulandı';message=String(durum.mesaj||'Firebase geri okuma doğrulaması başarılı.')+' · '+puanDurumTarihiYaz(durum.updatedAt);
        }else if(durum?.durum==='error'){
            level='error';title='Son puan gönderiminde hata';message=String(durum.mesaj||'Puan gönderimi doğrulanamadı.')+' · '+puanDurumTarihiYaz(durum.updatedAt);
        }else if(durum?.mesaj){level='warning';title='Son puan gönderim durumu';message=String(durum.mesaj)+' · '+puanDurumTarihiYaz(durum.updatedAt);}
        else message='Bu cihazda bekleyen puan yok. Henüz gönderim geçmişi bulunmuyor.';
        if(bar){
            bar.className='puan-guvence-bar durum-'+level;
            const unread=puanBildirimOkunmamisSayisi();
            const badgeText=pending.length?String(pending.length):(unread?String(unread):'');
            bar.innerHTML='<div class="puan-guvence-main"><span class="puan-guvence-dot"></span><div class="puan-guvence-copy"><strong>'+htmlEscape(title)+'</strong><span>'+htmlEscape(message)+'</span></div></div>'+
                '<div class="puan-guvence-actions"><span class="puan-guvence-connection '+(online?'is-online':'is-offline')+'">'+(online?'Firebase bağlı':'Firebase bağlantısı bekleniyor')+'</span><button type="button" class="bildirim-merkezi-button" onclick="bildirimMerkeziniAc()"><span aria-hidden="true">🔔</span> Bildirimler '+(badgeText?'<b>'+badgeText+'</b>':'')+'</button></div>';
        }
        puanAnaMenuKartiniGuncelle();
    }
    function puanFirebaseDurumuGoster(){
        const els=[...document.querySelectorAll('#puanFirebaseDurumu')];
        const pending=Object.values(offlineKuyrukGetir()).filter(x=>x&&x.kayit);
        let durum=puanFirebaseAnlikDurum||puanFirebaseDurumuOku();
        if(pending.length){
            const yetki=pending.some(x=>x.queueStatus==='yetki_hatasi');
            const kapali=pending.some(x=>x.queueStatus==='mac_kapali'||x.queueStatus==='mac_iptal');
            durum={durum:'error',mesaj:yetki
                ?'⚠ Firebase erişim yetkisi puan kaydını reddetti. Puan(lar) bu cihazın kuyruğunda; yönetici bağlantı/yetki ayarını kontrol etmeden gönderildi kabul etmeyin.'
                :kapali
                    ?'⚠ Kuyrukta maç kapalı/iptal olduğu için gönderilemeyen puan var. Bu puanlar Firebase’e aktarılmadı; yöneticiyle kontrol edin.'
                    :'⚠ '+pending.length+' puan Firebase’de henüz doğrulanmadı. Bu cihazın gönderim kuyruğunda bekliyor; bağlantı gelince yeniden denenecek.'};
        }
        for(const el of els){
            if(!durum?.mesaj){el.style.display='none';el.textContent='';continue;}
            el.style.display='block';el.className='puanlama-bilgi'+(durum.durum==='success'?'':' hata');
            el.setAttribute('role',durum.durum==='success'?'status':'alert');el.textContent=durum.mesaj;
        }
        puanDurumPaneliniGuncelle();
    }
    function puanAnaMenuKartiniGuncelle(){
        const host=document.getElementById('anaMenuPuanDurumu');if(!host)return;
        const pending=Object.values(offlineKuyrukGetir()).filter(x=>x&&x.kayit);
        const durum=puanFirebaseAnlikDurum||puanFirebaseDurumuOku();
        host.textContent=puanDurumOzetMetni();
        host.className='home-puan-summary'+(pending.length?' has-pending':(durum?.durum==='success'?' is-success':''));
        const count=document.getElementById('anaMenuKuyrukSayisi');if(count)count.textContent=String(pending.length);
    }
    function puanGuvenceModaliniKapat(){
        const el=document.getElementById('puanGuvenceModal');if(el)el.remove();
    }
    function puanGuvenceModaliniAc(baslik,icerik){
        puanGuvenceModaliniKapat();
        const root=document.createElement('div');root.id='puanGuvenceModal';root.className='puan-guvence-overlay';
        root.innerHTML='<div class="puan-guvence-modal" role="dialog" aria-modal="true" aria-label="'+htmlEscape(baslik)+'">'+
            '<div class="puan-guvence-modal-head"><h2>'+htmlEscape(baslik)+'</h2><button type="button" aria-label="Kapat" onclick="puanGuvenceModaliniKapat()">✕</button></div>'+
            '<div class="puan-guvence-modal-body">'+icerik+'</div></div>';
        root.addEventListener('click',ev=>{if(ev.target===root)puanGuvenceModaliniKapat();});
        document.body.appendChild(root);
    }
    function puanKriterDetayiHtml(kayit){
        const p=kayit?.puanlar||{};
        const rows=Array.from({length:13},(_,i)=>{
            const v=p[i]??p[String(i)]??'—';
            return '<div class="puan-guvence-criterion"><span>'+htmlEscape((i+1)+'. '+(krit[i]?.t||'Kriter '+(i+1)))+'</span><b>'+htmlEscape(v)+'</b></div>';
        }).join('');
        const total=Array.from({length:13},(_,i)=>Number(p[i]??p[String(i)]??0)).reduce((a,b)=>a+(Number.isFinite(b)?b:0),0);
        return '<div class="puan-guvence-criteria">'+rows+'</div><div class="puan-guvence-total">Toplam: '+total+'/100</div>';
    }
    function puanKuyrukDurumMetni(item){
        const s=String(item?.queueStatus||'bekliyor');
        const names={gonderim_on_kontrol:'Gönderim ön kontrolünde',bekliyor:'Gönderim bekliyor',
            dogrulama_bekliyor:'Firebase doğrulaması bekliyor',sure_dogrulama_bekliyor:'Süre doğrulaması bekliyor',
            yetki_hatasi:'Firebase yetki hatası',mac_kapali_arsiv_bekliyor:'Maç kapalı; arşiv doğrulaması bekliyor',
            sure_engeli_arsiv_bekliyor:'Süre sınırı nedeniyle resmî puana aktarılmadı'};
        return names[s]||s.replace(/_/g,' ');
    }
    function puanKuyrukDetayiniAc(){
        const entries=Object.entries(offlineKuyrukGetir()).filter(([,x])=>x&&x.kayit);
        if(!entries.length){puanGuvenceModaliniAc('Bekleyen puanlar','<div class="puan-guvence-empty">Bu cihazın gönderim kuyruğunda bekleyen puan bulunmuyor. Bu bilgi, taslakların resmî puan kaydına gönderildiği anlamına gelmez.</div>');return;}
        const html=entries.map(([key,item])=>{
            const r=item.kayit||{},s=r.secim||{},stamp=Number(item.puanGondermeAniClientAt||item.puanGondermeAni||item.queuedAt||r.localUpdatedAt||0);
            return '<article class="puan-guvence-record"><div class="puan-guvence-record-head"><div><strong>'+htmlEscape(r.macEtiketi||r.mac||item.macId||'Maç bilgisi yok')+'</strong><span>'+htmlEscape(item.kategori||'')+' · '+htmlEscape(s.taraf||'')+'</span></div><b class="puan-guvence-state">'+htmlEscape(puanKuyrukDurumMetni(item))+'</b></div>'+
                '<p><b>Öğrenci:</b> '+htmlEscape(s.ogr||'—')+' · <b>Okul:</b> '+htmlEscape(s.okul||'—')+'</p>'+
                '<p><b>Jüri:</b> '+htmlEscape(s.juri||'—')+' '+htmlEscape(s.juriAd||'')+' · <b>Gönderim:</b> '+htmlEscape(puanDurumTarihiYaz(stamp))+'</p>'+
                (item.lastError||item.reddedilmeNedeni?'<p class="puan-guvence-error"><b>Son hata:</b> '+htmlEscape(item.lastError||item.reddedilmeNedeni)+'</p>':'')+
                puanKriterDetayiHtml(r)+'<div class="puan-guvence-record-foot">Kayıt anahtarı: '+htmlEscape(key)+' · Bu ekran kaydı değiştirmez.</div></article>';
        }).join('');
        puanGuvenceModaliniAc('Bekleyen puanların ayrıntısı ('+entries.length+')',html);
    }
    async function juriPuanGecmisiniAc(){
        const clientId=getClientId();
        puanGuvenceModaliniAc('Gönderdiğim puanlar','<div class="puan-guvence-empty">Bu cihazın geçmiş kayıtları Firebase’den okunuyor…</div>');
        try{
            const cats=['ORTAOKUL','LİSE'];
            const snapshots=await Promise.all(cats.map(async kategori=>{
                const values=await Promise.all([db.ref('puanlar/'+kategori).once('value'),db.ref('arsiv/juriPuanYedekleri/'+kategori).once('value')]);
                return {kategori,live:values[0],archive:values[1]};
            }));
            const rows=[],seen=new Set();
            const add=(kategori,macId,key,record,source,state)=>{
                if(!record?.secim||!record?.puanlar)return;
                const recordClient=String(record.clientId||record.secim?.clientId||'');
                if(!recordClient||recordClient!==clientId)return;
                const stamp=Number(record.puanGondermeAniClientAt||record.puanGondermeAni||record.localUpdatedAt||record.yedekAt||record.createdAt||0);
                const sig=Array.from({length:13},(_,i)=>record.puanlar?.[i]??record.puanlar?.[String(i)]??'').join(',');
                const fingerprint=[kategori,macId,key,stamp,sig,!!record.reddedildi].join('|');
                if(seen.has(fingerprint))return;seen.add(fingerprint);
                rows.push({kategori,macId,record,source,state,stamp});
            };
            snapshots.forEach(({kategori,live,archive})=>{
                live.forEach(ch=>{const r=ch.val();add(kategori,kayitMacId(r),ch.key,r,'Resmî puan kaydı','Firebase’e kaydedilmiş');});
                archive.forEach(macNode=>macNode.forEach(recordNode=>{
                    const root=recordNode.val()||{},mid=macNode.key,key=recordNode.key;
                    if(root.sonDurum)add(kategori,mid,key,root.sonDurum,'Güncel yedek','Arşiv yedeği');
                    if(root.reddedilen)add(kategori,mid,key,root.reddedilen,'Reddedilen / süre dışı','Resmî puana eklenmedi');
                    if(root.bekleyen)add(kategori,mid,key,root.bekleyen,'Doğrulama bekleyen','İnceleme bekliyor');
                    Object.entries(root.gecmis||{}).forEach(([historyKey,record])=>add(kategori,mid,key+'_'+historyKey,record,'Geçmiş kopyası',record?.reddedildi?'Resmî puana eklenmedi':'Arşiv geçmişi'));
                }));
            });
            rows.sort((a,b)=>b.stamp-a.stamp);
            const note='<div class="puan-guvence-note">Kayıtlar bu tarayıcının cihaz kimliğiyle eşleştirilir. Başka cihazdaki veya tarayıcı verisi temizlenmiş geçmiş bu listede görünmeyebilir. Liste salt okunurdur; Firebase kayıtlarına müdahale etmez.</div>';
            if(!rows.length){puanGuvenceModaliniAc('Gönderdiğim puanlar',note+'<div class="puan-guvence-empty">Bu cihaz kimliğiyle eşleşen kayıt bulunamadı.</div>');return;}
            const html=rows.map(x=>{
                const r=x.record,s=r.secim||{};
                return '<article class="puan-guvence-record"><div class="puan-guvence-record-head"><div><strong>'+htmlEscape(r.macEtiketi||r.mac||x.macId)+'</strong><span>'+htmlEscape(x.kategori)+' · '+htmlEscape(x.source)+'</span></div><b class="puan-guvence-state">'+htmlEscape(x.state)+'</b></div>'+
                    '<p><b>Öğrenci:</b> '+htmlEscape(s.ogr||'—')+' · <b>Okul:</b> '+htmlEscape(s.okul||'—')+'</p>'+
                    '<p><b>Jüri:</b> '+htmlEscape(s.juri||'—')+' '+htmlEscape(s.juriAd||'')+' · <b>Tarih:</b> '+htmlEscape(puanDurumTarihiYaz(x.stamp))+'</p>'+
                    puanKriterDetayiHtml(r)+'</article>';
            }).join('');
            puanGuvenceModaliniAc('Gönderdiğim puanlar ('+rows.length+')',note+html);
        }catch(err){
            puanGuvenceModaliniAc('Gönderdiğim puanlar','<div class="puan-guvence-error">Geçmiş kayıtları okunamadı: '+htmlEscape(err?.message||err)+'<br>Firebase arşiv ve puan okuma izinlerini kontrol edin.</div>');
        }
    }
    function firebasePuanKaydiEslesiyor(bulut,beklenen){
        if(!bulut||!beklenen)return false;
        const a=bulut.secim||{},b=beklenen.secim||{};
        for(const k of ['macId','clientId'])if(String(bulut[k]||'')!==String(beklenen[k]||''))return false;
        for(const k of ['kategori','juri','juriAd','okul','ogr','taraf','hukOkul','muhOkul'])
            if(String(a[k]||'')!==String(b[k]||''))return false;
        for(let i=0;i<13;i++){
            const x=Number(bulut.puanlar?.[i]??bulut.puanlar?.[String(i)]);
            const y=Number(beklenen.puanlar?.[i]??beklenen.puanlar?.[String(i)]);
            if(!Number.isInteger(x)||x!==y)return false;
        }
        return true;
    }
    async function firebasePuanKaydiniDogrula(ref,beklenen){
        const snap=await ref.once('value');
        const bulut=snap.val();
        return {ok:firebasePuanKaydiEslesiyor(bulut, beklenen),bulut};
    }
    async function puanReddedilenKaydiniArsivle(item,neden,durum='puan_gonderimi_arsivlendi'){
        if(!item?.kayit||!item?.kategori||!item?.macId||!item?.kayitId)
            throw new Error('Reddedilen puan arşivi için maç/kayıt bilgisi eksik.');
        const ref=db.ref(`arsiv/juriPuanYedekleri/${item.kategori}/${item.macId}/${item.kayitId}/reddedilen`);
        const arsivKaydi={...item.kayit,reddedildi:true,reddedilmeNedeni:String(neden||'Resmî puan kaydına alınmadı.'),
            reddedildiAt:firebase.database.ServerValue.TIMESTAMP,
            yedekAt:firebase.database.ServerValue.TIMESTAMP,yedekOlayi:'juri_puani_resmi_disinda_koruma'};
        await ref.set(arsivKaydi);
        const kontrol=await ref.once('value');
        if(!firebasePuanKaydiEslesiyor(kontrol.val(),item.kayit))
            throw new Error('Reddedilen puan arşive yazıldı ancak 13 kriter geri okunarak doğrulanamadı.');
        await puanAktarimDenetiminiGuncelle(item,{
            durum, hata:String(neden||'Puan resmî kayda alınmadı; arşivde korundu.'),
            puanVerisi:{...(item.kayit.puanlar||{})},puanKayitId:item.kayitId,
            puanGonderildi:false,puanKuyrugaAlindi:false,reddedilenPuanArsivlendi:true
        });
        return true;
    }


    function offlineKuyrukKaydet(q) {
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q));
        networkDurumunuGuncelle();
        puanFirebaseDurumuGoster();
    }

    function aktifJuriAuditKaydiniBul(kategori, macId) {
        try {
            const d=JSON.parse(localStorage.getItem(JURI_SURE_AUDIT_OTURUM_KEY)||'null');
            if(!d?.logId||d.kategori!==kategori||d.macId!==macId)return null;
            return d;
        } catch(_) { return null; }
    }

    async function puanAktarimDenetiminiGuncelle(item, patch) {
        const sec=item?.kayit?.secim||{};
        const kategori=item?.kategori||'ORTAOKUL';
        const temel={
            kategori, macId:item?.macId||'', macEtiketi:item?.kayit?.macEtiketi||item?.kayit?.mac||'',
            okul:sec.okul||'', ogrenci:String(sec.ogr||'').split(' (')[0], taraf:sec.taraf||'',
            juri:sec.juri||'', juriAd:sec.juriAd||'', clientId:item?.kayit?.clientId||'',
            uygulamaSurumu:APP_VERSION
        };
        let logId=item?.auditLogId||'';
        try {
            if(!logId){
                const ref=db.ref(`arsiv/juriSureOlaylari/${kategori}`).push();
                await ref.set({...temel,...patch,islem:'puan_kayit_senkronizasyonu',
                    logId:ref.key,clientAt:Date.now(),createdAt:firebase.database.ServerValue.TIMESTAMP});
                item.auditLogId=ref.key;
                return;
            }
            const localQueue=juriSureAuditKuyruguGetir();
            const pending=localQueue.some(x=>x.kategori===kategori&&x.logId===logId);
            if(pending){
                juriSureAuditGuncellemeKuyrugaAl(kategori,logId,temel,patch);
                await juriSureAuditKuyrugunuGonder();
                return;
            }
            await db.ref(`arsiv/juriSureOlaylari/${kategori}/${logId}`).update({
                ...patch, updatedAt:firebase.database.ServerValue.TIMESTAMP
            });
        } catch(err) {
            console.warn('Puan aktarım denetim kaydı güncellenemedi:',err);
            if(logId){
                try{juriSureAuditGuncellemeKuyrugaAl(kategori,logId,temel,patch);}catch(queueErr){
                    console.warn('Puan aktarım denetimi yerel kuyruğa da alınamadı:',queueErr);
                }
            }
        }
    }

    let offlineKuyrukGonderiliyor=false;
    function puanKuyrukAnahtari(kategori,kayitId){return `${kategori}__${kayitId}`;}
    function puanKuyrukDurumunuGuncelle(kategori,kayitId,patch={}){
        const q=offlineKuyrukGetir(),key=puanKuyrukAnahtari(kategori,kayitId);
        if(!q[key])return false;
        q[key]={...q[key],...patch,sonYerelGuncellemeAt:Date.now()};
        offlineKuyrukKaydet(q);
        return true;
    }
    function puanKuyrugundanSil(kategori,kayitId){
        const q=offlineKuyrukGetir(),key=puanKuyrukAnahtari(kategori,kayitId);
        if(!q[key])return false;
        delete q[key];offlineKuyrukKaydet(q);return true;
    }
    function puaniKuyrugaEkle(item) {
        const q = offlineKuyrukGetir();
        const key = puanKuyrukAnahtari(item.kategori,item.kayitId);
        const onceki=q[key]||{};
        const audit=aktifJuriAuditKaydiniBul(item.kategori,item.macId);
        q[key] = { ...onceki, ...item,
            auditLogId:item.auditLogId||onceki.auditLogId||audit?.logId||'',
            queuedAt: onceki.queuedAt||item.queuedAt||Date.now(),
            queueStatus: item.queueStatus||onceki.queueStatus||'bekliyor' };
        offlineKuyrukKaydet(q);
        puanFirebaseDurumuYaz('queued','⚠ Puan bu cihazda kalıcı gönderim kuyruğuna alındı; Firebase’den geri okunarak doğrulanana kadar resmî kaydedildi sayılmayacak.',{
            kayitId:item.kayitId,macId:item.macId,ogr:item.kayit?.secim?.ogr,juri:item.kayit?.secim?.juri
        });
        return q[key];
    }

    async function offlineKuyruguGonder() {
        if(offlineKuyrukGonderiliyor)return;
        offlineKuyrukGonderiliyor=true;
        let q=null,degisti=false;
        try {
            if (!navigator.onLine || !firebaseBagli) return;
            q = offlineKuyrukGetir();
            const keys = Object.keys(q);
            if (!keys.length) return;
            for (const key of keys) {
                const item = q[key];
                try {
                    // Gönderim fonksiyonu ön kontrollerdeyse ikinci worker kayıtla yarışmaz.
                    if(['gonderim_on_kontrol','gonderim_devam_ediyor'].includes(item.queueStatus)){
                        const baslangic=Number(item.gonderimBaslatmaAt||item.queuedAt||Date.now());
                        if(Date.now()-baslangic<120000)continue;
                        q[key].queueStatus='bekliyor';degisti=true;
                    }
                    // Süre/maç engeliyle reddedilen kayıtlar hiçbir durumda resmî puana çevrilmez.
                    if(['mac_kapali_arsiv_bekliyor','sure_engeli_arsiv_bekliyor'].includes(item.queueStatus)){
                        await puanReddedilenKaydiniArsivle(item,item.reddedilmeNedeni||'Puan resmî kayda alınamadı; yönetici incelemesi için arşivlendi.',
                            item.queueStatus==='mac_kapali_arsiv_bekliyor'?'puan_mac_kapali_arsivlendi':'puan_sure_engeli_arsivlendi');
                        delete q[key];degisti=true;continue;
                    }
                    const mSnap = await db.ref(`maclar/${item.kategori}/${item.macId}`).once('value');
                    const m = mSnap.val();
                    if (m && ['kapali','iptal'].includes(m.durum)) {
                        const neden=m.durum==='iptal'?'Maç iptal edildiği için çevrimdışı puan resmî kayda aktarılamadı.':'Maç kapatıldığı için çevrimdışı puan resmî kayda aktarılamadı.';
                        q[key].queueStatus='mac_kapali_arsiv_bekliyor';q[key].officialSendAllowed=false;
                        q[key].reddedilmeNedeni=neden;degisti=true;offlineKuyrukKaydet(q);
                        await puanReddedilenKaydiniArsivle(item,neden,'puan_mac_kapali_arsivlendi');
                        delete q[key];degisti=true;continue;
                    }
                    // Gönderim çevrimdışıyken yapıldıysa, yeniden bağlanma anı değil jüri tıklama anı ölçülür.
                    if(item.queueStatus==='sure_dogrulama_bekliyor')continue;
                    const sec=item.kayit?.secim||{};
                    const timerId=ortakSureKimligi(sec.okul,(sec.ogr||'').split(' (')[0]);
                    const timerSnap=await db.ref('maclar/'+item.kategori+'/'+item.macId+'/konusmaSayaclari/'+timerId).once('value');
                    const timer=timerSnap.val();
                    const bas=Number(timer?.baslangicAt||0);
                    const clickAt=Number(item.puanGondermeAni||item.kayit?.puanGondermeAni||
                        ((Number(item.kayit?.localUpdatedAt||0)+Number(item.serverTimeOffsetAtClick||item.kayit?.serverTimeOffsetAtClick||0)))||
                        item.queuedAt||0);
                    if(!bas||!clickAt||clickAt<bas){
                        const neden='Ortak sayaç veya jüri gönderim anı doğrulanamadı. 13 kriter resmî puana aktarılmadı; yönetici incelemesi için güvenli kuyrukta bekliyor.';
                        q[key].queueStatus='sure_dogrulama_bekliyor';
                        q[key].lastError=neden;degisti=true;offlineKuyrukKaydet(q);
                        try{
                            const base='arsiv/juriPuanYedekleri/'+item.kategori+'/'+item.macId+'/'+item.kayitId;
                            const data={...item.kayit,queueStatus:'sure_dogrulama_bekliyor',beklemeNedeni:neden,
                                yedekAt:firebase.database.ServerValue.TIMESTAMP,yedekOlayi:'juri_puani_sure_dogrulama_bekliyor'};
                            await db.ref(base+'/bekleyen').set(data);
                            await db.ref(base+'/gecmis/'+String(clickAt||Date.now())+'_sure_dogrulama_bekliyor').set(data);
                        }catch(backupErr){
                            q[key].lastError=neden+' · Bulut arşiv hatası: '+String(backupErr?.message||backupErr);
                            offlineKuyrukKaydet(q);
                        }
                        await puanAktarimDenetiminiGuncelle(item,{
                            durum:'puan_sure_dogrulama_bekliyor',hata:q[key].lastError,
                            queueStatus:'sure_dogrulama_bekliyor',puanVerisi:{...(item.kayit?.puanlar||{})},
                            puanGonderildi:false,puanKuyrugaAlindi:true
                        });
                        continue;
                    }
                    if(clickAt>bas+(ORTAK_SURE_LIMIT+ORTAK_PUAN_EK_SURE)*1000){
                        const neden='Jüri puanı, 6 dakika + 1 dakikalık ek gönderim penceresinden sonra girmiş. Resmî puana eklenmedi; 13 kriter arşivlendi.';
                        q[key].queueStatus='sure_engeli_arsiv_bekliyor';
                        q[key].officialSendAllowed=false;
                        q[key].reddedilmeNedeni=neden;degisti=true;offlineKuyrukKaydet(q);
                        await puanReddedilenKaydiniArsivle(item,neden,'puan_sure_engeli_arsivlendi');
                        delete q[key];degisti=true;offlineKuyrukKaydet(q);
                        continue;
                    }
                    const rec = { ...item.kayit, serverSyncedAt: firebase.database.ServerValue.TIMESTAMP, offlineSynced: true };
                    const puanRef=db.ref(`puanlar/${item.kategori}/${item.kayitId}`);
                    // Aynı jüri daha sonra yeni puan gönderdiyse eski kuyruk kaydı yenisini ezemez.
                    const mevcutSnap=await puanRef.once('value');
                    const mevcut=mevcutSnap.val();
                    if(mevcut && Number(mevcut.localUpdatedAt||0)>Number(rec.localUpdatedAt||0)){
                        const kimlikUyumlu=firebasePuanKaydiEslesiyor(mevcut,{...rec,puanlar:mevcut.puanlar});
                        if(!kimlikUyumlu)throw new Error('Firebase’de daha yeni bir kayıt var ancak jüri/öğrenci kimliği eşleşmiyor. Eski kuyruk kaydı güvenlik için aktarılmadı.');
                        await puanAktarimDenetiminiGuncelle(item,{
                            durum:'puanlar_gonderildi_daha_yeni_kayit_korundu',
                            hata:'Kuyruktaki eski puan yerine Firebase’deki daha yeni ve kimliği doğrulanmış jüri kaydı korundu.',
                            puanGonderildi:true,puanKuyrugaAlindi:false,puanKayitDogrulandi:true
                        });
                        delete q[key];degisti=true;puanFirebaseDurumuTemizle(item.kayitId);continue;
                    }
                    await puanRef.set(rec);
                    const dogrulama=await firebasePuanKaydiniDogrula(puanRef,rec);
                    if(!dogrulama.ok)throw new Error('Firebase kuyruğa alınan puanı geri okuyup doğrulayamadı. Kayıt kuyrukta korunuyor.');
                    let yedekHatasi='';
                    try{
                        const yedekYolu=`arsiv/juriPuanYedekleri/${item.kategori}/${item.macId}/${item.kayitId}`;
                        await db.ref(yedekYolu+'/sonDurum').set({...rec,yedekAt:firebase.database.ServerValue.TIMESTAMP});
                        await db.ref(yedekYolu+'/gecmis/'+String(item.queuedAt||Date.now())).set({...rec,yedekAt:firebase.database.ServerValue.TIMESTAMP,yedekOlayi:'juri_puani_offline_senkronize'});
                    }catch(yedekErr){yedekHatasi=String(yedekErr?.message||yedekErr);console.warn('Offline puan doğrulandı ancak bağımsız arşiv yedeği yazılamadı:',yedekErr);}
                    if(item.taslakYolu)await db.ref(item.taslakYolu).transaction(cur=>{
                        if(!cur)return cur;
                        if(cur.durum==='gonderildi')return cur;
                        const now=Date.now();
                        return {...cur,durum:'gonderildi',tamamlandiAt:now,
                            tamamlananLocalUpdatedAt:Number(cur.localUpdatedAt||0),offlineSenkron:true};
                    },undefined,false).catch(e=>console.warn('Senkronize taslak kapatılamadı:',e));
                    if(item.taslakYerelAnahtari)try{localStorage.removeItem(item.taslakYerelAnahtari);}catch(_){}
                    await puanAktarimDenetiminiGuncelle(item,{
                        durum:'puanlar_gonderildi_offline_senkronize',puanGonderildi:true,
                        puanKuyrugaAlindi:false,puanKayitDogrulandi:true,puanGonderildiClientAt:Date.now(),
                        ...(yedekHatasi?{yedekHatasi,yedekDurumu:'ikincil_yedek_yazilamadi'}:{yedekDurumu:'kaydedildi'})
                    });
                    delete q[key];degisti=true;puanFirebaseDurumuTemizle(item.kayitId);
                } catch (err) {
                    console.warn('Offline kuyruk gönderilemedi:', err);
                    const code = String(err?.code || '').toLowerCase();
                    const arsivSadece=item.officialSendAllowed===false ||
                        ['mac_kapali_arsiv_bekliyor','sure_engeli_arsiv_bekliyor'].includes(item.queueStatus);
                    if(arsivSadece)q[key].queueStatus=item.queueStatus||'reddedilen_arsiv_bekliyor';
                    else if (code.includes('permission')) q[key].queueStatus = 'yetki_hatasi';
                    else if(String(err?.message||'').includes('daha yeni bir kayıt')) q[key].queueStatus='kayit_cakismasi';
                    else q[key].queueStatus = 'dogrulama_bekliyor';
                    q[key].lastError=String(err?.message||err);
                    degisti = true;
                    offlineKuyrukKaydet(q);
                    await puanAktarimDenetiminiGuncelle(item,{
                        durum:arsivSadece?'puan_reddi_arsiv_hatasi':(code.includes('permission')?'puan_kuyruk_yetki_hatasi':'puan_kuyruk_senkron_hatasi'),
                        hata:String(err?.message||err),queueStatus:q[key].queueStatus,
                        puanVerisi:{...(item.kayit?.puanlar||{})},puanGonderildi:false,puanKuyrugaAlindi:true
                    });
                    puanFirebaseDurumuYaz('error','⚠ Kuyruktaki puan Firebase’den doğrulanamadı. Kayıt bu cihazda korunuyor; yönetici kontrolü olmadan gönderildi kabul etmeyin.',{
                        kayitId:item.kayitId,macId:item.macId,ogr:item.kayit?.secim?.ogr,juri:item.kayit?.secim?.juri
                    });
                }
            }
            if (degisti) offlineKuyrukKaydet(q);
            puanFirebaseDurumuGoster();
        } finally {
            if(q&&degisti){try{offlineKuyrukKaydet(q);}catch(e){console.error('Kuyruk son kaydı yazılamadı:',e);}}
            offlineKuyrukGonderiliyor=false;
        }
    }


    function networkDurumunuGuncelle() {
        let el=document.getElementById('systemStatusBadge');
        if(!el){el=document.createElement('div');el.id='systemStatusBadge';el.className='system-status';document.body.appendChild(el);}
        const q=offlineKuyrukGetir(),n=Object.keys(q).length,online=navigator.onLine&&firebaseBagli;
        el.innerHTML='<span class="status-dot '+(online?'online':'offline')+'"></span>'+(online?'Çevrimiçi':'Çevrimdışı')+(n?' · Kuyruk: '+n:'');
        el.title=n?'Firebase’den doğrulanmamış yerel puan kaydı var.':'Yerel gönderim kuyruğu boş; bu, açık puan taslaklarının resmî kayda gönderildiği anlamına gelmez.';
        puanFirebaseDurumuGoster();
    }

    async function ensureMatchExists(kategori, hukOkul, muhOkul) {
        if (!hukOkul || !muhOkul) return null;
        const id = macKimligiOlustur(kategori, hukOkul, muhOkul);
        const ref = db.ref(`maclar/${kategori}/${id}`);
        await ref.transaction(cur => {
            if (cur) return cur; // Mevcut maç ve kesinleşmiş sonuç asla üzerine yazılmaz.
            return { id, kategori, hukOkul, muhOkul, etiket: macEtiketi(hukOkul, muhOkul), durum: 'acik', createdAt: Date.now(), updatedAt: Date.now(), version: 1 };
        });
        return id;
    }

    async function macDurumuGetir(kategori, macId) {
        if (!macId) return { durum:'acik' };
        const s = await db.ref(`maclar/${kategori}/${macId}`).once('value');
        return s.val() || { durum:'acik' };
    }

    function dinleyicileriTemizle() {
        ortakSureTemizle();
        if (aktifJuriListenerRef) { aktifJuriListenerRef.off(); aktifJuriListenerRef = null; }
        if (aktifJuriMacListenerRef) { aktifJuriMacListenerRef.off(); aktifJuriMacListenerRef = null; }
        aktifCanliPanelRefs.forEach(r => { try { r.off(); } catch (_) {} });
        aktifCanliPanelRefs = [];
        if (aktifTurnuvaRef) { try { aktifTurnuvaRef.off(); } catch (_) {} aktifTurnuvaRef = null; }
    }

    function anaMenu() {
        dinleyicileriTemizle();
        document.getElementById('app').innerHTML = `
            <main class="home-shell">
                <header class="home-head">
                    <div class="home-eyebrow">Iğdır İl Millî Eğitim Müdürlüğü</div>
                    <h1>Münazara Yönetim Sistemi</h1>
                    <p>Jüri değerlendirmesi ve turnuva yönetimi için ayrı çalışma alanları.</p>
                </header>
                <div class="home-grid">
                    <button class="home-link primary" onclick="renderPuanlamaSecim()">
                        <span><span class="home-card-title">📝 Jüri Modülü</span><span class="home-card-desc">Jüri kimliğinizi seçin, öğrencileri belirleyin ve 13 değerlendirme kriterini doğrudan puanlayın. Şifre gerekmez. Öğrenci seçilip “Kriterleri Puanla” açılınca ortak 6 dakikalık sayaç başlar; 5. dakikada uyarı verir. Son 1 dakika tüm açık jüri puanlama ekranlarında uyarılır. Bir jürinin puan göndermesi diğer jürilerin ortak süresini bitirmez; 6 dakika sonunda yalnızca 1 dakika ek gönderim penceresi kalır. Gerekirse ortak süre isteğe bağlı sıfırlanabilir; işlem günlüğe kaydedilir.</span></span>
                        <span class="home-arrow">→</span>
                    </button>
                    <button class="home-link" onclick="sifreliModulKontrol('yonetici')">
                        <span><span class="home-card-title">🔐 Yönetici Modülü</span><span class="home-card-desc">Fikstür, öğrenci listeleri, maç sonuçları, öğrenci süreleri, hükmen kararlar ve özel raporlar.</span></span>
                        <span class="home-arrow">→</span>
                    </button>
                </div>
                <section class="home-juri-puan-card"><div class="home-juri-puan-intro"><span class="home-juri-puan-eyebrow">JÜRİ PUAN TAKİBİ</span><h2>Bildirim ve kayıt durumu</h2><p id="anaMenuPuanDurumu" class="home-puan-summary">Gönderim durumu yükleniyor…</p></div><div class="home-juri-puan-side"><div class="home-juri-puan-count"><strong id="anaMenuKuyrukSayisi">0</strong><span>Bekleyen puan</span></div><div class="home-juri-puan-actions"><button type="button" class="home-notification-primary" onclick="bildirimMerkeziniAc()">🔔 Bildirim Merkezi</button><button type="button" onclick="juriPuanGecmisiniAc()">Puan geçmişim</button></div></div></section><div class="home-foot"><span>Fikstür ve jüri puanları merkezi Firebase üzerinde tutulur.</span><button onclick="renderHakkinda()">Uygulama Hakkında →</button></div>
            </main>`;
        puanFirebaseDurumuGoster();
    }

    function yoneticiOturumunuKapat() {
        sessionStorage.removeItem('adminGiris');
        sonRaporVerisi=null;
        anaMenu();
    }

    async function veriYedekleriniHazirla(kategori){
        const [pSnap,mSnap,pBakSnap,tBakSnap,sBakSnap]=await Promise.all([
            db.ref('puanlar/'+kategori).once('value'),
            db.ref('maclar/'+kategori).once('value'),
            db.ref('arsiv/juriPuanYedekleri/'+kategori).once('value'),
            db.ref('arsiv/konusmaSureYedekleri/'+kategori).once('value'),
            db.ref('arsiv/macSureYedekleri/'+kategori).once('value')
        ]);
        const pBak=pBakSnap.val()||{},tBak=tBakSnap.val()||{},sBak=sBakSnap.val()||{};
        const liveScores={},liveMatches={};
        pSnap.forEach(c=>{
            const v=c.val();if(!v?.secim||!v?.puanlar)return;
            const mid=kayitMacId(v),natural=puanKayitKimligi(v.secim,mid);
            if(!liveScores[mid])liveScores[mid]={};
            liveScores[mid][natural]=v;
        });
        mSnap.forEach(c=>liveMatches[c.key]=c.val());
        const updates={};let seedScore=0,seedTimer=0,seedSummary=0;
        for(const [mid,rows] of Object.entries(liveScores)){
            for(const [natural,v] of Object.entries(rows)){
                if(pBak[mid]?.[natural]?.sonDurum)continue;
                const base=`arsiv/juriPuanYedekleri/${kategori}/${mid}/${natural}`;
                const y={...v,macId:mid,yedekClientAt:Date.now(),yedekOlayi:'mevcut_kayit_koruma'};
                updates[base+'/sonDurum']=y;
                updates[base+'/gecmis/'+String(Date.now()+seedScore)]=y;seedScore++;
            }
        }
        for(const [mid,m] of Object.entries(liveMatches)){
            for(const [timerId,v] of Object.entries(m?.konusmaSayaclari||{})){
                if(tBak[mid]?.[timerId]?.sonDurum)continue;
                const base=`arsiv/konusmaSureYedekleri/${kategori}/${mid}/${timerId}`;
                const y={...v,macMeta:{id:mid,kategori,hukOkul:m.hukOkul||'',muhOkul:m.muhOkul||'',
                    etiket:m.etiket||'',durum:m.durum||'acik',fiksturNo:m.fiksturNo||null,
                    ogrenciKaynaklari:m.ogrenciKaynaklari||null},
                    yedekClientAt:Date.now(),yedekOlayi:'mevcut_sayac_koruma'};
                updates[base+'/sonDurum']=y;
                updates[base+'/gecmis/'+String(Date.now()+seedTimer)]=y;seedTimer++;
            }
            if(m?.sureEsitlik&&!sBak[mid]?.sonDurum){
                const base=`arsiv/macSureYedekleri/${kategori}/${mid}`;
                const y={...m.sureEsitlik,yedekClientAt:Date.now(),yedekOlayi:'mevcut_mac_suresi_koruma'};
                updates[base+'/sonDurum']=y;
                updates[base+'/gecmis/'+String(Date.now()+seedSummary)]=y;seedSummary++;
            }
        }
        if(Object.keys(updates).length)await db.ref().update(updates);
        const scoreArchive={...pBak},timerArchive={...tBak},summaryArchive={...sBak};
        for(const [path,value] of Object.entries(updates)){
            const parts=path.split('/');
            if(parts[1]==='juriPuanYedekleri'){
                const mid=parts[3],natural=parts[4];
                if(parts[5]==='sonDurum'){
                    scoreArchive[mid]=scoreArchive[mid]||{};scoreArchive[mid][natural]=scoreArchive[mid][natural]||{};
                    scoreArchive[mid][natural].sonDurum=value;
                }
            }else if(parts[1]==='konusmaSureYedekleri'){
                const mid=parts[3],id=parts[4];
                if(parts[5]==='sonDurum'){
                    timerArchive[mid]=timerArchive[mid]||{};timerArchive[mid][id]=timerArchive[mid][id]||{};
                    timerArchive[mid][id].sonDurum=value;
                }
            }else if(parts[1]==='macSureYedekleri'&&parts[4]==='sonDurum'){
                const mid=parts[3];summaryArchive[mid]=summaryArchive[mid]||{};summaryArchive[mid].sonDurum=value;
            }
        }
        const macIds=new Set([...Object.keys(liveScores),...Object.keys(liveMatches),
            ...Object.keys(scoreArchive),...Object.keys(timerArchive),...Object.keys(summaryArchive)]);
        const rows=[];
        for(const mid of macIds){
            const scores=Object.entries(scoreArchive[mid]||{}).filter(([_,x])=>x?.sonDurum?.secim&&x?.sonDurum?.puanlar);
            const live=liveScores[mid]||{};
            const missingScores=scores.filter(([id])=>!live[id]).length;
            const timers=Object.entries(timerArchive[mid]||{}).filter(([_,x])=>x?.sonDurum?.baslangicAt);
            const currentTimers=liveMatches[mid]?.konusmaSayaclari||{};
            const missingTimers=timers.filter(([id])=>!currentTimers[id]).length;
            const summary=summaryArchive[mid]?.sonDurum||null;
            const missingSummary=!!(summary&&!liveMatches[mid]?.sureEsitlik);
            const sample=scores[0]?.[1]?.sonDurum?.secim||{};
            const meta=timers[0]?.[1]?.sonDurum?.macMeta||{};
            rows.push({kategori,macId:mid,etiket:liveMatches[mid]?.etiket||meta.etiket||
                (sample.hukOkul&&sample.muhOkul?macEtiketi(sample.hukOkul,sample.muhOkul):mid),
                scoreCount:scores.length,missingScores,timerCount:timers.length,missingTimers,
                missingSummary,hasBackups:scores.length+timers.length+(summary?1:0)>0});
        }
        rows.sort((a,b)=>a.etiket.localeCompare(b.etiket,'tr'));
        return {kategori,rows,seedScore,seedTimer,seedSummary};
    }

    async function renderVeriKurtarma(){
        if(!adminYetkiliMi())return alert('Bu bölüm yalnızca yönetici tarafından açılabilir.');
        dinleyicileriTemizle();
        document.getElementById('app').innerHTML=`<div class="card" style="max-width:1100px;">
            <h2>🛟 Puan ve Süre Yedekleri</h2>
            <div class="puanlama-bilgi">Bu ekran mevcut puan ve süreleri yedekler. Eksik kayıtları Firebase arşivinden geri yükler; var olan puanların, sayaçların ve resmî sonuçların üzerine yazmaz. İlk açılışta mevcut veriler için başlangıç yedeği hazırlanır.</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn" style="width:auto;background:#1d4ed8" onclick="renderVeriKurtarma()">↻ Yedekleri tara</button>
                <button class="btn" style="width:auto;background:#475569" onclick="renderYoneticiMenu()">← Yönetici menüsü</button>
            </div>
            <div id="veriKurtarmaDurum" class="puanlama-bilgi">ORTAOKUL ve LİSE kayıtları taranıyor…</div>
            <div id="veriKurtarmaListe"></div>
        </div>`;
        const host=document.getElementById('veriKurtarmaListe'),durum=document.getElementById('veriKurtarmaDurum');
        try{
            const results=await Promise.all(['ORTAOKUL','LİSE'].map(veriYedekleriniHazirla));
            if(!host||!durum)return;
            const total=results.reduce((n,x)=>n+x.rows.length,0);
            const backed=results.reduce((n,x)=>n+x.rows.filter(r=>r.hasBackups).length,0);
            const missing=results.reduce((n,x)=>n+x.rows.reduce((a,r)=>a+r.missingScores+r.missingTimers+(r.missingSummary?1:0),0),0);
            const seeded=results.reduce((n,x)=>n+x.seedScore+x.seedTimer+x.seedSummary,0);
            durum.innerHTML=`Tarama tamamlandı. ${backed}/${total} maç için yedek bulundu · ${missing} eksik kayıt · ${seeded} mevcut kayıt için ilk yedek oluşturuldu.`;
            let html='';
            for(const group of results){
                html+=`<h3>${group.kategori}</h3><div style="overflow-x:auto"><table class="tutanak-table"><tr><th>Maç</th><th>Yedek Puan</th><th>Eksik Puan</th><th>Yedek Süre</th><th>Eksik Süre</th><th>İşlem</th></tr>`;
                for(const r of group.rows){
                    const missing=r.missingScores+r.missingTimers+(r.missingSummary?1:0);
                    html+=`<tr><td>${htmlEscape(r.etiket)}</td><td>${r.scoreCount}</td><td class="${r.missingScores?'jury-missing':'jury-ok'}">${r.missingScores}</td><td>${r.timerCount+(r.missingSummary?1:0)}</td><td class="${missing?'jury-missing':'jury-ok'}">${r.missingTimers+(r.missingSummary?1:0)}</td><td>${missing?`<button class="btn" style="padding:7px;margin:0;background:#0f766e" onclick="veriYedegindenKurtar('${group.kategori}','${r.macId}')">Eksikleri kurtar</button>`:'—'}</td></tr>`;
                }
                html+='</table></div>';
            }
            host.innerHTML=html||'<div class="puanlama-bilgi">Henüz puan veya süre yedeği bulunmuyor.</div>';
        }catch(err){
            if(durum)durum.textContent='Yedek taraması başarısız: '+String(err?.message||err);
        }
    }

    async function veriYedegindenKurtar(kategori,macId){
        if(!adminYetkiliMi())return alert('Yönetici yetkisi gerekiyor.');
        if(!navigator.onLine||!firebaseBagli)return alert('Yedekten kurtarma için Firebase bağlantısı gerekir.');
        if(!confirm('Eksik kayıtlar yedekten geri yüklenecek. Mevcut puanlar, süreler ve sonuçlar değiştirilmeyecek. Devam edilsin mi?'))return;
        let puan=0,sayac=0,toplamSure=0;
        try{
            const base=`arsiv/juriPuanYedekleri/${kategori}/${macId}`;
            const tBase=`arsiv/konusmaSureYedekleri/${kategori}/${macId}`;
            const [pSnap,tSnap,sSnap,mSnap]=await Promise.all([
                db.ref(base).once('value'),db.ref(tBase).once('value'),
                db.ref(macSureYedekYolu(kategori,macId)+'/sonDurum').once('value'),
                db.ref(`maclar/${kategori}/${macId}`).once('value')
            ]);
            const pItems=pSnap.val()||{},tItems=tSnap.val()||{},summary=sSnap.val()||null;
            const scoreEntries=Object.entries(pItems).filter(([_,x])=>x?.sonDurum?.secim&&x?.sonDurum?.puanlar);
            const timerEntries=Object.entries(tItems).filter(([_,x])=>x?.sonDurum?.baslangicAt);
            const scoreSample=scoreEntries[0]?.[1]?.sonDurum;
            const timerSample=timerEntries[0]?.[1]?.sonDurum;
            const seed=timerSample?.macMeta|| (scoreSample?.secim?.hukOkul&&scoreSample?.secim?.muhOkul?{
                id:macId,kategori,hukOkul:scoreSample.secim.hukOkul,muhOkul:scoreSample.secim.muhOkul,
                etiket:macEtiketi(scoreSample.secim.hukOkul,scoreSample.secim.muhOkul),durum:'acik'}:null);
            let liveMac=mSnap.val();
            if(!liveMac&&seed){
                const restored=await db.ref(`maclar/${kategori}/${macId}`).transaction(cur=>cur||{
                    ...seed,id:macId,kategori,durum:['acik','kapali','iptal'].includes(seed.durum)?seed.durum:'acik',
                    createdAt:Date.now(),updatedAt:Date.now(),restoredFromArchive:true,restoredAt:Date.now()
                },undefined,false);
                liveMac=restored.snapshot?.val()||null;
            }
            for(const [natural,x] of scoreEntries){
                const target=db.ref(`puanlar/${kategori}/${natural}`);
                const result=await target.transaction(cur=>cur||{...x.sonDurum,restoredFromArchive:true,restoredAt:Date.now()},undefined,false);
                if(result.committed)puan++;
            }
            for(const [timerId,x] of timerEntries){
                const target=db.ref(`maclar/${kategori}/${macId}/konusmaSayaclari/${timerId}`);
                const result=await target.transaction(cur=>cur||{...x.sonDurum,restoredFromArchive:true,restoredAt:Date.now()},undefined,false);
                if(result.committed)sayac++;
            }
            if(summary?.ogrenciler){
                const result=await db.ref(`maclar/${kategori}/${macId}`).transaction(cur=>{
                    if(!cur||cur.sureEsitlik)return cur;
                    cur.sureEsitlik={...summary,restoredFromArchive:true,restoredAt:Date.now()};
                    return cur;
                },undefined,false);
                if(result.committed)toplamSure++;
            }
            alert(`Kurtarma tamamlandı. Geri yüklenen: ${puan} jüri puanı, ${sayac} öğrenci sayacı, ${toplamSure} maç süre toplamı. Var olan kayıtlar değiştirilmedi.`);
            await renderVeriKurtarma();
        }catch(err){alert('Yedekten kurtarma tamamlanamadı: '+String(err?.message||err));}
    }

    function renderYoneticiMenu() {
        if(!adminYetkiliMi()) return sifreliModulKontrol('yonetici');
        dinleyicileriTemizle();
        document.getElementById('app').innerHTML = `
            <main class="home-shell admin-menu-shell">
                <header class="home-head"><div class="home-eyebrow">Yetkili alanı</div><h1>Yönetici Modülü</h1><p>İşlem yapmak istediğiniz bölümü seçin.</p></header>
                <div class="home-grid">
                    <button class="home-link primary" onclick="renderYoneticiCanliPanel()"><span><span class="home-card-title">✅ Maç Yönetimi</span><span class="home-card-desc">Jüri puanlarını canlı izle, sonuçları kesinleştir, fikstürle eşleştir veya maçı yeniden aç.</span></span><span class="home-arrow">→</span></button>
                    <button class="home-link" onclick="yoneticiManuelMacEkleEkraniAc()"><span><span class="home-card-title">＋ Yeni / Manuel Maç Oluştur</span><span class="home-card-desc">İstediğiniz iki okulu seçerek yeni maç oluşturun; jüri ve süre modüllerinde görünür.</span></span><span class="home-arrow">→</span></button>
                    <button class="home-link" onclick="renderTurnuva()"><span><span class="home-card-title">📅 Fikstür ve Görevlendirmeler</span><span class="home-card-desc">Maç takvimi, jüri ve öğretmen görevlendirmeleri, resmî listeler.</span></span><span class="home-arrow">→</span></button>
                    <button class="home-link" onclick="renderFiksturIstisnaYonetimi()"><span><span class="home-card-title">🔄 Fikstür İstisnaları</span><span class="home-card-desc">Yönetici: okulu değiştir, maçı boş seansa taşı veya 35 numaralı boş maçı doldur.</span></span><span class="home-arrow">→</span></button>
                     <button class="home-link" onclick="showReport()"><span><span class="home-card-title">📊 Özel Sonuçlar ve Tutanak</span><span class="home-card-desc">Öğrenci/jüri puanları, Excel ve tek maça odaklı kompakt A4 yatay PDF.</span></span><span class="home-arrow">→</span></button>
                    <button class="home-link" onclick="renderOgrenci()"><span><span class="home-card-title">🏫 Okullar ve Öğrenciler</span><span class="home-card-desc">Öğrenci kayıtları, okul/öğrenci adı düzenleme, Excel aktarma ve gerektiğinde liste eşleştirme.</span></span><span class="home-arrow">→</span></button>
                    <button class="home-link" onclick="renderJuriSureLoglari()"><span><span class="home-card-title">🧾 Jüri / Süre İşlem Günlüğü</span><span class="home-card-desc">Puanlama ekranı açılışlarını, süre aşımı engellerini ve isteğe bağlı sıfırlama işlemlerini; başarı/iptal durumlarıyla birlikte görüntüle.</span></span><span class="home-arrow">→</span></button>
                    <button class="home-link" onclick="renderVeriKurtarma()"><span><span class="home-card-title">🛟 Puan ve Süre Yedekleri</span><span class="home-card-desc">Eksik jüri puanlarını, öğrenci sayaçlarını ve maç süre toplamlarını yedeklerden mevcut kayıtların üzerine yazmadan kurtar.</span></span><span class="home-arrow">→</span></button>
                </div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">
                    <button class="btn" style="width:auto;min-width:170px;" onclick="anaMenu()">← Ana Menü</button>
                    <button class="btn" style="width:auto;min-width:170px;background:#7f1d1d;" onclick="yoneticiOturumunuKapat()">🔒 Yönetici Çıkışı</button>
                </div>
            </main>`;
    }

    async function juriPuanArsivGecmisiniYukle(){
        if(!adminYetkiliMi())return;
        const host=document.getElementById('juriPuanGecmisGovde');if(!host)return;
        host.textContent='Firebase puan arşivleri okunuyor…';
        try{
            const cats=['ORTAOKUL','LİSE'];
            const snaps=await Promise.all(cats.map(k=>db.ref('arsiv/juriPuanYedekleri/'+k).once('value')));
            const rows=[],seen=new Set();
            snaps.forEach((snap,ci)=>{
                const kategori=cats[ci];
                snap.forEach(macNode=>{
                    macNode.forEach(kayitNode=>{
                        const root=kayitNode.val()||{};
                        const add=(record,source,key)=>{
                            if(!record?.secim||!record?.puanlar)return;
                            const fingerprint=[kategori,macNode.key,kayitNode.key,source,key||''].join('|');
                            if(seen.has(fingerprint))return;
                            seen.add(fingerprint);
                            rows.push({kategori,macId:macNode.key,source,record});
                        };
                        if(root.sonDurum)add(root.sonDurum,'Güncel yedek','');
                        if(root.reddedilen)add(root.reddedilen,'Süre/işlem nedeniyle arşivlenen','');
                        if(root.bekleyen)add(root.bekleyen,'Süre doğrulaması bekliyor','');
                        Object.entries(root.gecmis||{}).forEach(([key,record])=>add(record,'Geçmiş kaydı',key));
                    });
                });
            });
            rows.sort((a,b)=>{
                const ta=Number(a.record.puanGondermeAniClientAt||a.record.puanGondermeAni||a.record.localUpdatedAt||a.record.yedekAt||a.record.createdAt||0);
                const tb=Number(b.record.puanGondermeAniClientAt||b.record.puanGondermeAni||b.record.localUpdatedAt||b.record.yedekAt||b.record.createdAt||0);
                return tb-ta;
            });
            if(!rows.length){host.textContent='Firebase arşivinde henüz jüri puanı bulunmuyor.';return;}
            const html=rows.map(x=>{
                const r=x.record,sec=r.secim||{},raw=r.puanlar||{};
                const stamp=Number(r.puanGondermeAniClientAt||r.puanGondermeAni||r.localUpdatedAt||r.yedekAt||r.createdAt||0);
                const date=stamp?new Date(stamp).toLocaleString('tr-TR'):'Tarih bilgisi yok';
                const values=Array.from({length:13},(_,i)=>raw[i]??raw[String(i)]??'—');
                const total=values.reduce((sum,value)=>sum+(Number.isFinite(Number(value))?Number(value):0),0);
                const criteria=values.map((value,i)=>htmlEscape((i+1)+'. '+(krit[i]?.t||'Kriter '+(i+1))+': '+value)).join('<br>');
                const state=r.reddedildi?'Resmî puana eklenmedi':(r.queueStatus||r.yedekOlayi||r.durum||'Arşiv kaydı');
                return '<tr><td style="white-space:nowrap">'+htmlEscape(date)+'</td><td>'+htmlEscape(x.kategori)+'<br>'+htmlEscape(r.macEtiketi||r.mac||x.macId)+'</td><td>'+htmlEscape(sec.okul||'—')+'<br><b>'+htmlEscape(sec.ogr||'—')+'</b></td><td>'+htmlEscape(sec.juri||'—')+'<br>'+htmlEscape(sec.juriAd||'')+'</td><td>'+htmlEscape(x.source)+'<br>'+htmlEscape(state)+'</td><td style="text-align:left;min-width:320px">'+criteria+'<b style="display:block;margin-top:6px;color:#facc15">Toplam: '+total+'/100</b></td></tr>';
            }).join('');
            host.innerHTML='<div style="font-size:12px;color:#94a3b8;margin-bottom:8px">'+rows.length+' tarihsel kayıt bulundu.</div><div style="overflow:auto"><table class="tutanak-table" style="min-width:1250px"><thead><tr><th>Tarih</th><th>Kategori / maç</th><th>Okul / öğrenci</th><th>Jüri</th><th>Arşiv kaynağı / durum</th><th>13 kriter ve toplam</th></tr></thead><tbody>'+html+'</tbody></table></div>';
        }catch(err){
            host.className='puanlama-bilgi hata';
            host.textContent='Geriye dönük jüri puan arşivi okunamadı: '+String(err?.message||err)+' · Firebase arşiv okuma yetkisini kontrol edin.';
        }
    }

    async function renderJuriSureLoglari(){
        if(!adminYetkiliMi())return sifreliModulKontrol('yonetici');
        dinleyicileriTemizle();
        document.getElementById('app').innerHTML=`<div class="card" style="max-width:1250px;">
            <h2>Jüri / Süre İşlem Günlüğü</h2>
            <div class="puanlama-bilgi">Bu bölüm jüri puanlama ekranı açılışlarını, puan gönderim/geri okuma hatalarını, çevrimdışı aktarım kuyruğunu, süre engellerini ve isteğe bağlı sıfırlamaları gösterir. “Puanlar gönderildi” yalnızca Firebase geri okuma doğrulaması başarılıysa kullanılır. Kuyrukta, hata veya doğrulama bekleyen kayıtları maç sonuçlandırılmadan önce inceleyin.</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;">
                <button class="btn" style="width:auto;background:#1d4ed8" onclick="renderJuriSureLoglari()">↻ Günlüğü yenile</button>
                <button class="btn" style="width:auto;background:#475569" onclick="renderYoneticiMenu()">← Yönetici menüsü</button>
                <button class="btn" style="width:auto;background:#0f766e" onclick="juriPuanArsivGecmisiniYukle()">↻ Geriye dönük puan arşivini yenile</button>
            </div>
            <div id="juriSureLogGovde" class="puanlama-bilgi">İşlem kayıtları yükleniyor…</div>
            <h3 style="margin-top:24px">Geriye Dönük Jüri Puan Kayıtları</h3>
            <div class="puanlama-bilgi">Resmî puanlar, güncellenmiş kayıtların geçmiş kopyaları, süre nedeniyle resmî kayda alınmayan puanlar ve doğrulama bekleyen kayıtlar. Arşivdeki puanlar resmî puanı otomatik değiştirmez.</div>
            <div id="juriPuanGecmisGovde" class="puanlama-bilgi">Puan arşivi yükleniyor…</div>
        </div>`;
        const host=document.getElementById('juriSureLogGovde');
        void juriPuanArsivGecmisiniYukle();
        try{
            const cats=['ORTAOKUL','LİSE'];
            const snaps=await Promise.all(cats.map(k=>db.ref(`arsiv/juriSureOlaylari/${k}`).limitToLast(500).once('value')));
            const rowMap=new Map();
            snaps.forEach((snap,i)=>snap.forEach(ch=>{
                const v={...ch.val(),kategori:ch.val()?.kategori||cats[i],logId:ch.key};
                rowMap.set(`${v.kategori}/${v.logId}`,v);
            }));
            juriSureAuditKuyruguGetir().forEach(item=>rowMap.set(`${item.kategori}/${item.logId}`,
                {...item.kayit,kategori:item.kategori,logId:item.logId,durum:item.kayit?.durum||'aktarim_bekliyor',syncDurumu:'bekliyor'}));
            const rows=Array.from(rowMap.values());
            rows.sort((a,b)=>Number(b.queuedAt||b.updatedAt||b.createdAt||b.clientAt||b.updatedClientAt||0)-Number(a.queuedAt||a.updatedAt||a.createdAt||a.clientAt||a.updatedClientAt||0));
            if(!rows.length){host.textContent='Henüz jüri/süre işlem günlüğü bulunmuyor. Bu sürümden itibaren açılış, süre engeli, sıfırlama uygulaması ve iptal bilgileri burada birikir.';return;}
            const tarih=v=>{const n=Number(v.queuedAt||v.updatedAt||v.createdAt||v.clientAt||v.updatedClientAt||0);return n?new Date(n).toLocaleString('tr-TR'):'Tarih bekleniyor';};
            const evetHayir=v=>v===true?'Evet':v===false?'Hayır':'—';
            const html=rows.map(v=>{
                const puanHam=v.puanVerisi||v.puanlar||{};
                const puanDetayi=Array.from({length:13},(_,i)=>puanHam[i]??puanHam[String(i)]??null);
                const puanToplamiLog=puanDetayi.reduce((n,x)=>n+(Number.isFinite(Number(x))?Number(x):0),0);
                const puanDetayiMetni=puanDetayi.some(x=>x!==null)
                    ?'Kriterler: '+puanDetayi.map((x,i)=>(i+1)+'. '+(krit[i]?.t||'Kriter '+(i+1))+': '+(x===null?'—':x)).join(' · ')+' · Toplam: '+puanToplamiLog+'/100'
                    :'';
                const details=[puanDetayiMetni,v.reddedilenPuanArsivlendi?'Puan resmî tabloya eklenmeden arşivlendi':'',v.sebep?`Gerekçe: ${v.sebep}`:'',v.hata?`Hata: ${v.hata}`:'',v.puanKuyrukHatasi?`Kuyruk hatası: ${v.puanKuyrukHatasi}`:'',v.firebaseHatasiKodu?`Firebase kodu: ${v.firebaseHatasiKodu}`:'',v.puanGondermeEngelNedeni?`Gönderim engeli: ${v.puanGondermeEngelNedeni}`:'',v.queueStatus?`Kuyruk durumu: ${v.queueStatus}`:'',v.kayitId?`Kayıt: ${v.kayitId}`:'',v.yedekHatasi?`İkincil yedek hatası: ${v.yedekHatasi}`:'',v.iptalNedeni?`İptal: ${v.iptalNedeni}`:'',v.sifirlamaDurumu?`Sıfırlama durumu: ${v.sifirlamaDurumu}`:'',v.kaynakEkran?`Kaynak: ${v.kaynakEkran}`:'',v.syncDurumu==='bekliyor'?'Denetim kaydı aktarım bekliyor':'' ].filter(Boolean).join(' · ');
                const state=String(v.durum||'—');
                const color=state==='uygulandi'||state==='acildi'||state.startsWith('puanlar_gonderildi')?'#34d399':state.includes('engellendi')||state.includes('hata')||state.includes('kuyru')||state==='basarisiz'?'#fca5a5':state==='iptal_edildi'?'#fbbf24':'#cbd5e1';
                return `<tr><td style="white-space:nowrap">${htmlEscape(tarih(v))}</td><td>${htmlEscape(v.islem||'—')}</td><td>${htmlEscape(v.kategori||'—')}<br>${htmlEscape(v.macEtiketi||v.macId||'—')}</td><td>${htmlEscape(v.okul||'—')}<br><b>${htmlEscape(v.ogrenci||'—')}</b> · ${htmlEscape(v.taraf||'—')}</td><td>${htmlEscape(v.juri||'—')}<br>${htmlEscape(v.juriAd||'')}</td><td style="font-weight:800;color:${color}">${htmlEscape(state)}</td><td>${evetHayir(v.sifirlamaKullanildi)}</td><td style="min-width:260px;white-space:normal">${htmlEscape(details||v.hata||'—')}</td></tr>`;
            }).join('');
            host.innerHTML=`<div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">Son ${rows.length} kayıt gösteriliyor (kategori başına en fazla 500 kayıt; çevrimdışı yerel kayıtlar varsa aktarım bekliyor olarak görünür).</div><div style="overflow:auto"><table class="tutanak-table" style="min-width:1100px"><thead><tr><th>Tarih</th><th>İşlem</th><th>Kategori / Maç</th><th>Okul / Öğrenci</th><th>Jüri</th><th>Sonuç</th><th>Sıfırlama kullanıldı mı?</th><th>Gerekçe / ayrıntı</th></tr></thead><tbody>${html}</tbody></table></div>`;
        }catch(err){host.className='puanlama-bilgi hata';host.textContent='Jüri/süre işlem günlüğü okunamadı: '+String(err?.message||err)+' · Firebase arşiv okuma iznini kontrol edin.';}
    }

    function renderHakkinda() {
        dinleyicileriTemizle();
        document.getElementById('app').innerHTML = `
            <div class="card" style="text-align:center;">
                <h2>Uygulama Hakkında</h2>
                <div style="font-size:15px; color:var(--text-muted); margin-bottom:20px; line-height:1.6;">
                    Bu yazılım, münazara turnuvalarının jüri değerlendirmelerini, puan tutanaklarını ve eleme ağaçlarını dijital, güvenli ve gerçek zamanlı olarak yönetmek amacıyla geliştirilmiştir.
                </div>
                <div class="about-team-list">
                    <div style="font-size:12px; text-transform:uppercase; color:var(--accent); font-weight:bold; letter-spacing:1px; margin-bottom:12px; text-align:center;">Developed and Written by</div>
                    <div class="about-team-item">💻 Muhammed Fatih TURAN</div>
                    <div class="about-team-item">💻 Ali GENÇ</div>
                    <div class="about-team-item">💻 Sümeyye AZİTİ</div>
                    <div class="about-team-item">💻 Onur GÜLTEKİN</div>
                    <div class="about-team-item">💻 Taylan GÜL</div>
                </div>
                <div style="font-size:13px; color:var(--text-muted); margin-top:15px;">Iğdır Millî Eğitim Müdürlüğü AR-GE Birimi Projesidir.</div>
                <div style="font-size:11px; color:var(--text-muted); margin-top:8px;">Sürüm ${APP_VERSION} · Merkezi maç/turnuva durumu · çevrimdışı puan kuyruğu</div>
                <button class="btn" style="background:#475569; margin-top:25px;" onclick="anaMenu()">← Ana Menüye Dön</button>
            </div>`;
    }

    function sifreliModulKontrol(modulId) {
        if (!adminYetkiliMi() && !adminSifreDogrula('Bu alana erişmek için yetkili şifresini giriniz:')) return;
        if (modulId === 'ogrenci') return renderOgrenci();
        if (modulId === 'turnuva') return renderTurnuva();
        if (modulId === 'canli') return renderYoneticiCanliPanel();
        if (modulId === 'yonetici') return renderYoneticiMenu();
    }

    