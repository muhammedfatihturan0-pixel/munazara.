// --- YÖNETİCİ CANLI PANELİ ---
    let yoneticiFiksturMaclari = [];
    let yoneticiResmiFiksturDurumu = null;
    let yoneticiSonPanelVerileri = null;
    let yoneticiMacGorunumu = 'aktif'; // Aktif maçlar tek listede; sonuçlananlar arşivde.
    let yoneticiSonPanelMacSatirlari = [];
    // Resmî sonuç, operasyon maç kaydının durumundan BAĞIMSIZ bir Firebase ağacında tutulur.
    // Bu ekran yalnızca okur: 'AÇIK' kayıtları sessizce kapatmaz, sonuçları değiştirmez.
    let aktifJuriCanliDurumMonitorRef=null;
    function juriTakipBugunKey(){
        const d=new Date();
        return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    }
    function renderJuriCanliTakip(){
        if(!adminYetkiliMi())return sifreliModulKontrol('yonetici');
        dinleyicileriTemizle();
        const gun=juriTakipBugunKey();
        const kategori=secimler.kategori==='LİSE'?'lise':'ortaokul';
        document.getElementById('app').innerHTML=`
            <main class="card admin-jury-monitor-page">
                <header class="admin-jury-monitor-head">
                    <div><span class="home-eyebrow">CANLI OPERASYON</span><h2>Jüri Bağlantı ve Kayıt Takibi</h2>
                    <p>Üç jüri tabletinin bağlantısını, kuyruk durumunu ve son puan gönderimlerini tek ekrandan izleyin.</p></div>
                    <span class="admin-jury-monitor-live"><i></i> Canlı izleme</span>
                </header>
                <div class="admin-jury-monitor-filters">
                    <label>Görev günü<input id="juriCanliGun" type="date" value="${gun}" onchange="juriCanliTakipFiltresiniUygula()"></label>
                    <label>Kategori<select id="juriCanliKategori" onchange="juriCanliTakipFiltresiniUygula()">
                        <option value="ortaokul" ${kategori==='ortaokul'?'selected':''}>Ortaokul</option>
                        <option value="lise" ${kategori==='lise'?'selected':''}>Lise</option>
                    </select></label>
                    <button type="button" onclick="juriCanliTakibiniYenile()">↻ Yenile</button>
                </div>
                <div id="juriCanliTakipOzet" class="admin-jury-monitor-summary">Üç jüri cihazı bekleniyor…</div>
                <div id="juriCanliTakipHost" class="admin-jury-monitor-grid">
                    <div class="admin-jury-monitor-empty">Jüri durumları okunuyor…</div>
                </div>
                <div class="admin-jury-monitor-foot">Bu ekran yalnızca ${gun} tarihli ${kategori==='lise'?'lise':'ortaokul'} jüri cihaz durumlarını okur. Puan, fikstür ve turnuva kayıtlarını değiştirmez. Bağlantı kesilirse tabletin son görülme zamanı gösterilir.</div>
                <div class="admin-jury-monitor-actions"><button class="btn" onclick="renderYoneticiMenu()">← Yönetici Paneli</button><button class="btn" onclick="renderYoneticiCanliPanel()">Maç Yönetimine Git →</button></div>
            </main>`;
        juriCanliTakibiniBaslat();
    }
    function juriCanliTakipRefiniKapat(){
        if(aktifJuriCanliDurumMonitorRef){
            try{aktifJuriCanliDurumMonitorRef.off();}catch(_){}
            aktifCanliPanelRefs=aktifCanliPanelRefs.filter(x=>x!==aktifJuriCanliDurumMonitorRef);
            aktifJuriCanliDurumMonitorRef=null;
        }
    }
    function juriCanliTakipFiltresiniUygula(){
        juriCanliTakibiniBaslat();
    }
    function juriCanliTakibiniYenile(){
        juriCanliTakibiniBaslat();
    }
    function juriCanliGecenSure(ts){
        const at=Number(ts||0);
        if(!at)return 'Henüz bağlantı kaydı yok';
        const seconds=Math.max(0,Math.floor((Date.now()-at)/1000));
        if(seconds<10)return 'Az önce';
        if(seconds<60)return seconds+' saniye önce';
        const minutes=Math.floor(seconds/60);
        if(minutes<60)return minutes+' dakika önce';
        const hours=Math.floor(minutes/60);
        return hours+' saat önce';
    }
    function juriCanliSaatYaz(ts){
        const at=Number(ts||0);
        return at?new Date(at).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
    }
    function juriCanliJuriKartiniCiz(slot,label,record){
        const r=record||{};
        const lastSeen=Number(r.lastSeenAt||r.lastSeenClientAt||0);
        const stale=!lastSeen||(Date.now()-lastSeen)>75000;
        const online=!!r.online&&!stale;
        const pending=Number(r.pendingCount||0);
        const lastStatus=String(r.lastScoreStatus||'');
        const statusTone=pending?'warning':lastStatus==='error'?'error':lastStatus==='success'?'success':lastStatus==='queued'||lastStatus==='pending'?'warning':'neutral';
        const connText=online?'Bağlı':r.connectionStatus==='oturum_kapali'?'Jüri oturumu kapatıldı':lastSeen?'Bağlantı yok':'Henüz giriş yapmadı';
        const stateText=pending?pending+' puan kuyrukta':lastStatus==='success'?'Son puan doğrulandı':lastStatus==='error'?'Son gönderimde hata':lastStatus==='queued'?'Gönderim bekliyor':r.screen==='puanlama'?'Puanlama ekranında':r.screen==='juri_secim'?'Jüri seçim ekranında':'Hazır';
        const identity=r.ad||'Jüri oturumu henüz açılmadı';
        const roleName=r.yedekMi?'Yedek jüri · '+(r.yedekYerine||label)+' koltuğu':label;
        const currentMatch=[r.macEtiketi,r.taraf,r.okul].filter(Boolean).join(' · ');
        const student=r.ogrenci?'Öğrenci: '+r.ogrenci:'Öğrenci henüz seçilmedi';
        const lastMessage=r.lastScoreMessage?htmlEscape(r.lastScoreMessage):'Henüz puan gönderim olayı bildirilmedi.';
        const lastEvent=r.lastScoreAt?'Son puan işlemi: '+juriCanliSaatYaz(r.lastScoreAt):'Son puan işlemi yok';
        const client=r.clientId?'Cihaz: '+htmlEscape(String(r.clientId).slice(0,14)):'';
        return `<article class="admin-jury-device-card ${online?'is-online':'is-offline'}">
            <header><div class="admin-jury-device-seat"><span>${slot}</span><div><b>${label}</b><small>${htmlEscape(roleName)}</small></div></div>
                <span class="admin-jury-status-pill ${online?'online':'offline'}"><i></i>${connText}</span></header>
            <div class="admin-jury-device-identity">${htmlEscape(identity)}</div>
            <div class="admin-jury-device-state state-${statusTone}">${htmlEscape(stateText)}</div>
            <div class="admin-jury-device-detail"><span>Aktif ekran</span><b>${r.screen==='puanlama'?'Puanlama':r.screen==='juri_secim'?'Jüri seçimi':r.screen==='kapali'?'Oturum kapalı':'Uygulama / bekleme'}</b></div>
            <div class="admin-jury-device-detail"><span>Karşılaşma</span><b>${htmlEscape(currentMatch||'Henüz maç seçilmedi')}</b></div>
            <div class="admin-jury-device-detail"><span>Öğrenci</span><b>${htmlEscape(student)}</b></div>
            <div class="admin-jury-device-detail"><span>Bekleyen kayıt</span><b class="${pending?'text-warning':''}">${pending}</b></div>
            <div class="admin-jury-device-last"><b>${htmlEscape(lastEvent)}</b><p>${lastMessage}</p></div>
            <footer><span>Son görülme: ${htmlEscape(juriCanliGecenSure(lastSeen))}</span><span>${client}</span></footer>
        </article>`;
    }
    function juriCanliTakipVerisiniCiz(data,gun,kategori){
        const host=document.getElementById('juriCanliTakipHost');
        const summary=document.getElementById('juriCanliTakipOzet');
        if(!host||!summary)return;
        const seats=[
            {key:'juri1',label:'1. Jüri'},
            {key:'juri2',label:'2. Jüri'},
            {key:'juri3',label:'3. Jüri'}
        ];
        const records=seats.map(x=>data?.[x.key]||null);
        const online=records.filter(r=>r&&r.online&&Number(r.lastSeenAt||r.lastSeenClientAt)&&Date.now()-Number(r.lastSeenAt||r.lastSeenClientAt)<=75000).length;
        const pending=records.reduce((n,r)=>n+Number(r?.pendingCount||0),0);
        const errors=records.filter(r=>r&&(r.lastScoreStatus==='error'||Number(r.pendingCount||0)>0)).length;
        summary.innerHTML='<div class="admin-jury-summary-stat"><b>'+online+'/3</b><span>Bağlı jüri</span></div>'+
            '<div class="admin-jury-summary-stat"><b>'+pending+'</b><span>Bekleyen puan</span></div>'+
            '<div class="admin-jury-summary-stat"><b>'+errors+'</b><span>Kontrol gerektiren cihaz</span></div>'+
            '<div class="admin-jury-summary-note">'+htmlEscape(gun)+' · '+(kategori==='lise'?'Lise':'Ortaokul')+'</div>';
        host.innerHTML=seats.map((seat,i)=>juriCanliJuriKartiniCiz(i+1,seat.label,records[i])).join('');
    }
    function juriCanliTakibiniBaslat(){
        if(!adminYetkiliMi())return;
        const host=document.getElementById('juriCanliTakipHost');
        const gun=document.getElementById('juriCanliGun')?.value||'';
        const kategori=document.getElementById('juriCanliKategori')?.value||'ortaokul';
        if(!host||!/^\\d{4}-\\d{2}-\\d{2}$/.test(gun))return;
        juriCanliTakipRefiniKapat();
        host.innerHTML='<div class="admin-jury-monitor-empty">Üç jüri tabletinden canlı durum bekleniyor…</div>';
        const ref=db.ref(JURI_CANLI_DURUM_YOLU+'/'+gun+'/'+kategori);
        aktifJuriCanliDurumMonitorRef=ref;
        aktifCanliPanelRefs.push(ref);
        let sonVeri={};
        ref.on('value',snap=>{
            sonVeri=snap.val()||{};
            juriCanliTakipVerisiniCiz(sonVeri,gun,kategori);
        },err=>{
            const target=document.getElementById('juriCanliTakipHost');
            if(target)target.innerHTML='<div class="admin-jury-monitor-error">Jüri durumları okunamadı: '+htmlEscape(err?.message||err)+'. Firebase okuma izinlerini kontrol edin.</div>';
        });
        if(juriCanliTakipYenileTick)clearInterval(juriCanliTakipYenileTick);
        juriCanliTakipYenileTick=setInterval(()=>{
            if(!document.getElementById('juriCanliTakipHost')){
                clearInterval(juriCanliTakipYenileTick);juriCanliTakipYenileTick=null;return;
            }
            juriCanliTakipVerisiniCiz(sonVeri,gun,kategori);
        },10000);
    }
    
    function canliResmiMacSonucu(fiksturNo, kategori){
        const no=Number(fiksturNo);
        if(!Number.isInteger(no)||no<=0)return null;
        const v=yoneticiResmiFiksturDurumu?.finalizedMatches?.[no];
        if(!v || (v.kategori && v.kategori!==kategori))return null;
        return v;
    }
    function yoneticiTabloFiltresiniGuncelle(){
        if(yoneticiSonPanelVerileri)canliPaneliCiz(...yoneticiSonPanelVerileri);
    }
    async function yoneticiMaciniHazirla(kategori,macId){
        const ref=db.ref(`maclar/${kategori}/${macId}`);
        let f=yoneticiFiksturMaclari.find(x=>x.id===macId && x.kategori===kategori);
        let s=await ref.once('value');
        let mac=s.val();
        if(!f&&mac?.hukOkul&&mac?.muhOkul){
            f=yoneticiFiksturMaclari.find(x=>x.kategori===kategori&&
                okulCiftiEslesiyor(x.hukOkul,x.muhOkul,mac.hukOkul,mac.muhOkul))||null;
        }
        if((!mac||!mac.hukOkul||!mac.muhOkul||!String(mac.durum||'').trim())&&!f){
            // Liste henüz yüklenmemişse, yalnızca bu eksik kayıt için sabit fikstürü yeniden oku.
            try{
                const liste=await puanlamaFiksturMaclariniOku();
                const raw=liste.find(x=>x.cat===(kategori==='LİSE'?'lise':'ortaokul')&&
                    macKimligiOlustur(kategori,x.team1,x.team2)===macId&&puanlamaGecerliFiksturMaci(x));
                if(raw)f=puanlamaFiksturMacKaydi(raw);
            }catch(err){console.warn('Eksik maç alanları için fikstür yeniden okunamadı:',err);}
        }
        if(!mac){
            if(!f)throw new Error('Bu maçın resmî fikstür bilgisi bulunamadı. Fikstür ekranından kontrol edin.');
            await ensureMatchExists(kategori,f.hukOkul,f.muhOkul);
            s=await ref.once('value');
            mac=s.val();
        }
        if(!mac)throw new Error('Maç kaydı oluşturulamadı.');
        // Eski/eksik Firebase düğümlerinde yalnızca eksik metadata onarılır.
        // Puan, sayaç, toplam süre, sonuç ve mevcut diğer alanlar aynen korunur.
        const durumMetni=String(mac.durum||'').trim();
        const durumNorm=durumMetni.toLocaleLowerCase('tr-TR').replace(/ı/g,'i').replace(/ç/g,'c');
        const durumBilinen=['acik','open','kapali','closed','iptal','cancelled'].includes(durumNorm);
        const durumEksik=!durumMetni;
        const durumDuzeltmeGerekli=durumBilinen&&mac.durum!==(
            ['acik','open'].includes(durumNorm)?'acik':
            ['kapali','closed'].includes(durumNorm)?'kapali':'iptal');
        if((!mac.hukOkul||!mac.muhOkul||durumEksik||durumDuzeltmeGerekli) && f?.hukOkul && f?.muhOkul){
            const repaired=await ref.transaction(cur=>{
                if(!cur)return cur;
                const next={...cur};
                if(!next.hukOkul)next.hukOkul=f.hukOkul;
                if(!next.muhOkul)next.muhOkul=f.muhOkul;
                if(!next.id)next.id=macId;
                if(!next.kategori)next.kategori=kategori;
                if(!next.etiket)next.etiket=macEtiketi(f.hukOkul,f.muhOkul);
                if(!next.fiksturNo)next.fiksturNo=f.fiksturNo||null;
                const raw=String(next.durum||'').trim();
                const norm=raw.toLocaleLowerCase('tr-TR').replace(/ı/g,'i').replace(/ç/g,'c');
                if(!raw){
                    // Durum alanı boşsa, kapanış kanıtı bulunmayan maç açık kabul edilir.
                    // Kapanış işareti/sonucu varsa yanlışlıkla yeniden açma.
                    next.durum=(next.sonuc||next.closedAt)?'kapali':'acik';
                }else if(['acik','open'].includes(norm))next.durum='acik';
                else if(['kapali','closed'].includes(norm))next.durum='kapali';
                else if(['iptal','cancelled'].includes(norm))next.durum='iptal';
                return next;
            },undefined,false);
            mac=repaired.snapshot?.val()||mac;
        }
        if(!mac.hukOkul||!mac.muhOkul)
            throw new Error('Maç kaydında okul bilgisi eksik. Sabit fikstürden güvenli onarım yapılamadı; puan ve süre verileri korunuyor.');
        if(!String(mac.durum||'').trim())
            throw new Error('Maç kaydının durumu eksik ve güvenli biçimde onarılamadı; puan ve süreler korunuyor.');
        return mac;
    }
    function puanAktarimSorunuMu(v) {
        const durum=String(v?.durum||'').toLocaleLowerCase('tr-TR');
        if(durum.startsWith('puanlar_gonderildi')||durum==='basarili'||durum==='uygulandi')return false;
        return durum.includes('engellendi')||durum.includes('hata')||durum.includes('kuyru')||
            durum.includes('dogrulanamadi')||durum.includes('basarisiz')||durum.includes('kayit_cakismasi')||
            durum.includes('gonderim_baslatildi')||durum.includes('aktarim_bekliyor')||durum.includes('arsivlendi');
    }
    function canliPuanAktarimUyarilariniCiz(kayitlar) {
        const host=document.getElementById('puanAktarimSorunlari');
        if(!host)return;
        const birlesik=new Map();
        (kayitlar||[]).forEach((v,i)=>birlesik.set(String(v.kayitId||v.puanKayitId||v.logId||('audit_'+i)),v));
        // Aynı tarayıcıdaki yerel gönderim kuyruğu, bulut günlüğü ulaşmamış olsa da görünür.
        Object.values(offlineKuyrukGetir()).forEach(item=>{
            const sec=item?.kayit?.secim||{},id=String(item?.kayitId||item?.kayit?.kayitId||'');
            const onceki=birlesik.get(id)||{};
            birlesik.set(id,{
                ...onceki,kategori:item.kategori,macId:item.macId,
                macEtiketi:item.kayit?.macEtiketi||item.kayit?.mac||onceki.macEtiketi,
                okul:sec.okul||onceki.okul,ogrenci:String(sec.ogr||'').split(' (')[0]||onceki.ogrenci,
                juri:sec.juri||onceki.juri,taraf:sec.taraf||onceki.taraf,
                durum:'yerel_puan_kuyruk_'+String(item.queueStatus||'bekliyor'),
                hata:item.lastError||onceki.hata,puanVerisi:item.kayit?.puanlar||onceki.puanVerisi,
                kayitId:id,localOnly:true,queueStatus:item.queueStatus,queuedAt:item.queuedAt
            });
        });
        const sorunlar=Array.from(birlesik.values()).filter(puanAktarimSorunuMu)
            .sort((a,b)=>Number(b.updatedAt||b.createdAt||b.clientAt||b.updatedClientAt||0)-
                         Number(a.updatedAt||a.createdAt||a.clientAt||a.updatedClientAt||0));
        if(!sorunlar.length){
            host.innerHTML='<h3 style="margin:0 0 8px;color:var(--text-main);">✅ Jüri Puan Aktarımı</h3><div class="puanlama-bilgi">Son 200 denetim kaydında bekleyen veya başarısız puan aktarımı görünmüyor.</div>';
            return;
        }
        const rows=sorunlar.slice(0,12).map(v=>{
            const at=Number(v.queuedAt||v.updatedAt||v.createdAt||v.clientAt||v.updatedClientAt||0);
            const tarih=at?new Date(at).toLocaleString('tr-TR'):'Tarih bekleniyor';
            const durum=String(v.durum||'Kontrol gerekli');
            const aciklama=v.hata||v.puanKuyrukHatasi||v.puanGondermeEngelNedeni||
                (durum.includes('kuyru')?'Puan Firebase’de doğrulanmadı; kuyrukta bekliyor.':'Yönetici kontrolü gerekiyor.');
            const mac=v.macEtiketi||v.macId||'Maç bilgisi yok';
            const kisi=[v.okul,v.ogrenci].filter(Boolean).join(' · ')||'Öğrenci bilgisi yok';
            const ham=v.puanVerisi||v.puanlar||{};
            const puanDizisi=Array.from({length:13},(_,i)=>ham[i]??ham[String(i)]??'—');
            const puanMetni=puanDizisi.every(x=>x==='—')?'—':puanDizisi.join(' / ');
            return '<tr><td style="white-space:nowrap">'+htmlEscape(tarih)+'</td><td>'+htmlEscape(mac)+'</td><td>'+htmlEscape(kisi)+'</td><td>'+htmlEscape(v.juri||v.juriAd||'—')+'</td><td style="font-weight:800;color:#fca5a5">'+htmlEscape(durum)+'</td><td>'+htmlEscape(v.localOnly?'Bu cihaz':'Firebase')+'</td><td style="min-width:230px;white-space:normal">'+htmlEscape(puanMetni)+'</td><td style="min-width:260px;white-space:normal">'+htmlEscape(aciklama)+'</td></tr>';
        }).join('');
        host.innerHTML='<h3 style="margin:0 0 8px;color:#fca5a5;">⚠ Jüri Puan Aktarımı · '+sorunlar.length+' bildirim</h3>'+
            '<div class="puanlama-bilgi hata">Bu kayıtlar resmî puan tablosunda onaylanmış kayıtlar değildir. Arşivlenen ret kayıtları ayrıca saklanır. “Bu cihaz” kaynaklı kayıtlar yalnızca bu tarayıcıdaki yerel kuyruktan okunur; diğer jüri cihazları çevrimdışıyken burada görünemez. Maç sonuçlandırılmadan önce aşağıdaki kayıtları kontrol edin.</div>'+
            '<div style="overflow:auto"><table class="tutanak-table" style="min-width:1250px"><thead><tr><th>Tarih</th><th>Maç</th><th>Okul / Öğrenci</th><th>Jüri</th><th>Durum</th><th>Kaynak</th><th>13 Kriter</th><th>Ayrıntı</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
            (sorunlar.length>12?'<div class="sure-hint">İlk 12 kayıt gösteriliyor. Ayrıntılar için Jüri / Süre İşlem Günlüğü bölümünü açın.</div>':'');
    }

    function renderYoneticiCanliPanel() {
        if(!adminYetkiliMi())return alert('Yönetici yetkisi gerekiyor.');
        yoneticiMacGorunumu='aktif';
        yoneticiFiksturMaclari=[];
        yoneticiResmiFiksturDurumu=null;
        dinleyicileriTemizle();
        document.getElementById('app').innerHTML = `
            <div class="card" style="max-width:1200px;">
                <h2>Yönetici Canlı Operasyon Paneli</h2>
                <div class="btn-grid" style="grid-template-columns:1fr 1fr;margin-bottom:15px;">
                    <button class="btn kat-btn ${secimler.kategori==='ORTAOKUL'?'btn-active':''}" onclick="katSec(this,'ORTAOKUL','canli')">ORTAOKUL</button>
                    <button class="btn kat-btn ${secimler.kategori==='LİSE'?'btn-active':''}" onclick="katSec(this,'LİSE','canli')">LİSE</button>
                </div>
                <div id="liveMetrics" class="admin-summary-grid"></div>
                <div id="puanAktarimSorunlari" class="kriter-card" style="margin:0 0 14px;"></div>
                <div class="kriter-card"><h3 style="margin-top:0;color:var(--text-main);">Maçlar · Canlı Puanlar ve 3/3 Jüri Durumu</h3>
                  <div class="sure-hint"><b>Tek ana işlem: Sonucu Kesinleştir.</b> Üç jüri ve öğrenci kadrosu tam olduğunda puanlardan resmî galibi hesaplar, maçı kapatır ve jüri ekranlarına sonucu bir kez duyurur. Eşitlikte tamamlanmış konuşma süreleri kullanılır. Kadro doğrulanmadıysa manuel denetim açılır. <b>Geriye dönük süre düzeltmesi galibi değiştirmez.</b> Hükmen, iptal ve yönetici kararı istisnai/gelişmiş işlemlerdedir.</div>
                   <div class="live-filter-bar no-print"><input id="liveMatchSearch" placeholder="Maç numarası veya okul ara..." oninput="yoneticiTabloFiltresiniGuncelle()" aria-label="Maç ara"><label><input id="iptalGoster" type="checkbox" style="width:auto;margin:0 5px 0 0;" onchange="yoneticiTabloFiltresiniGuncelle()">İptal edilenleri göster</label></div>
                  <div class="btn-grid no-print" style="grid-template-columns:1fr 1fr;gap:7px;margin:8px 0;">
                    <button id="liveViewAktif" class="btn" style="margin:0;padding:8px" onclick="yoneticiMacGorunumuSec('aktif')">Aktif Maçlar</button>
                    <button id="liveViewArsiv" class="btn" style="margin:0;padding:8px" onclick="yoneticiMacGorunumuSec('arsiv')">Arşiv</button>
                  </div>
                  <div class="sure-hint">Aktif maçlar en yakın tarih ve saate göre sıralanır. Sonucu kesinleşen veya kapatılan maçlar otomatik arşive ayrılır; puan, süre ve sonuçlar silinmez.</div>
                  <div id="liveMatches" style="overflow-x:auto;">Yükleniyor...</div></div>
                <div id="sureModalHost" class="no-print"></div>
                <button class="btn no-print" style="background:#0f766e" onclick="yoneticiManuelMacEkleEkraniAc()">＋ Yeni / Manuel Maç Kaydet</button>
                <div class="no-print" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <button class="btn" style="background:var(--primary);border:none;" onclick="yedekJsonIndir()">⬇ JSON Yedeği İndir</button>
                    <button class="btn" style="background:var(--success);border:none;" onclick="firebaseArsivYedegiAl(false)">☁ Firebase Arşivine Yedekle</button>
                </div>
                <button class="btn" style="background:#475569" onclick="anaMenu()">← Ana Menü</button>
            </div>`;
        let skorlar=[], maclar={}, okullar={};
        const render=()=>{yoneticiSonPanelVerileri=[skorlar,maclar,okullar];canliPaneliCiz(skorlar,maclar,okullar);};
        const pRef=db.ref('puanlar/'+secimler.kategori); pRef.on('value',s=>{skorlar=snapshotKayitlariniTekillestir(s);render();}); aktifCanliPanelRefs.push(pRef);
        const mRef=db.ref('maclar/'+secimler.kategori); mRef.on('value',s=>{maclar={};s.forEach(c=>maclar[c.key]=c.val());render();}); aktifCanliPanelRefs.push(mRef);
        const oRef=db.ref('okullar/'+secimler.kategori); oRef.on('value',s=>{okullar={};s.forEach(c=>{okullar[c.key]=[];c.forEach(x=>okullar[c.key].push(String(x.val())));});render();}); aktifCanliPanelRefs.push(oRef);
        // Üst tur eşleşmeleri Firebase galipleri değiştiğinde canlı yenilenir.
        // Böylece yönetici panelini kapatıp açmaya gerek kalmaz.
        const currentKat=secimler.kategori;
        const aktarimAuditRef=db.ref(`arsiv/juriSureOlaylari/${currentKat}`).limitToLast(200);
        aktarimAuditRef.on('value',snap=>{
            if(secimler.kategori!==currentKat||!document.getElementById('puanAktarimSorunlari'))return;
            const kayitlar=[];snap.forEach(ch=>kayitlar.push({...ch.val(),logId:ch.key}));
            canliPuanAktarimUyarilariniCiz(kayitlar);
        },err=>{
            const host=document.getElementById('puanAktarimSorunlari');
            if(host)host.innerHTML='<h3 style="margin:0;color:#fca5a5;">⚠ Puan aktarım denetimi okunamadı</h3><div class="puanlama-bilgi hata">'+htmlEscape(err?.message||err)+'</div>';
        });
        aktifCanliPanelRefs.push(aktarimAuditRef);
        let sonYukleme=0;
        const canliEslesmeYenile=()=>{
            const surum=++sonYukleme;
            void puanlamaFiksturMaclariniOku().then(liste=>{
                if(surum!==sonYukleme||!document.getElementById('liveMatches')||secimler.kategori!==currentKat)return;
                yoneticiFiksturMaclari=liste.filter(x=>x.cat===(currentKat==='LİSE'?'lise':'ortaokul')&&puanlamaGecerliFiksturMaci(x))
                    .map(x=>puanlamaFiksturMacKaydi(x));
                render();
            }).catch(err=>{
                if(surum!==sonYukleme)return;
                const host=document.getElementById('liveMatches');
                if(host && !document.getElementById('fiksturCanliHata'))host.insertAdjacentHTML('beforebegin',`<div id="fiksturCanliHata" class="puanlama-bilgi hata">Fikstür okunamadı; yenilemek gerekebilir: ${htmlEscape(err.message||err)}</div>`);
            });
        };
        canliEslesmeYenile();
        const fRef=db.ref('fikstur/tekSalon_2026_2027');
        // İframe de aynı anlık veriyi okuduğundan kısa gecikme ilk değer yarışını önler.
        fRef.on('value',snapshot=>{
            if(secimler.kategori!==currentKat || !document.getElementById('liveMatches'))return;
            yoneticiResmiFiksturDurumu=snapshot.val()||{};
            render();
            setTimeout(()=>{if(document.getElementById('liveMatches')&&secimler.kategori===currentKat)canliEslesmeYenile();},350);
        });
        aktifCanliPanelRefs.push(fRef);
    }

    function skorEslesmeAnahtari(ad) {
        return puanMetniNormalize(ad).replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR');
    }

    function okulCiftiEslesiyor(a,b,c,d) {
        const aa=skorEslesmeAnahtari(a), bb=skorEslesmeAnahtari(b);
        const cc=skorEslesmeAnahtari(c), dd=skorEslesmeAnahtari(d);
        return !!aa && !!bb && ((aa===cc && bb===dd) || (aa===dd && bb===cc));
    }

    function sureyiMetneDonustur(saniye) {
        if (!Number.isFinite(Number(saniye)) || saniye === null || saniye === undefined) return '—';
        const n=Math.max(0,Math.floor(Number(saniye)));
        return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
    }

    function sureMetniniCoz(metin) {
        const s=String(metin || '').trim();
        if (!/^\d{1,3}:[0-5]\d$/.test(s)) return null;
        const [dakika,saniye]=s.split(':').map(Number);
        const toplam=dakika*60+saniye;
        return Number.isSafeInteger(toplam) && toplam>0 && toplam<=359999 ? toplam : null;
    }

    // V3.12 - Ana sayfadan tek adımda öğrenci sürelerine erişim.
    // Fikstür + varsa canlı maçlar okunur; maçı seçince öğrenciler doğru takıma bağlanır.
    let sureHizliMaclar=new Map();
    let sureHizliEkranSurumu=0;
    async function renderSureAnaEkran(){
        window.sureEkraniGirisKaynak=adminYetkiliMi()&&!document.getElementById('sureHizliMacSec')&&
            (document.getElementById('liveMatches')||document.getElementById('yonetici-menu'))?'yonetici':'juri';
        // Jüri ve süre görevlileri yönetici şifresi olmadan kendi süre ekranına girebilir.
        dinleyicileriTemizle();
        const id=++sureHizliEkranSurumu, kategori=secimler.kategori;
        document.getElementById('app').innerHTML=`<div class="card" style="max-width:960px">
            <h2>⏱ Öğrenci Süreleri — Hızlı Giriş</h2>
            <div class="puanlama-bilgi">Maçın iki takımına ait öğrenciler <b>otomatik eşleştirilir.</b> Her öğrenci için sayacı başlatıp durdurabilir ya da süreyi dakika:saniye biçiminde girebilirsiniz. Kaydet düğmesi yalnızca seçilen maçın öğrenci sürelerini günceller; jüri puanlarını değiştirmez.</div>
            <div class="btn-grid" style="grid-template-columns:1fr 1fr">
                <button class="btn kat-btn ${kategori==='ORTAOKUL'?'btn-active':''}" onclick="katSec(this,'ORTAOKUL','sure')">ORTAOKUL</button>
                <button class="btn kat-btn ${kategori==='LİSE'?'btn-active':''}" onclick="katSec(this,'LİSE','sure')">LİSE</button>
            </div>
            <label class="puanlama-etiket" for="sureHizliMacSec">Maç seçin</label>
            <select id="sureHizliMacSec" onchange="sureHizliSecimiGuncelle()"><option value="">Fikstür yükleniyor…</option></select>
            <div class="sure-hint" id="sureHizliBilgi">Sadece gerçek iki takımlı maçlar listelenir. Kapanmış maçlara da geriye dönük süre belgesi eklenebilir; resmî sonuç değişmez.</div>
            <button id="sureHizliAcBtn" class="btn" style="background:#0369a1" onclick="sureHizliAc()" disabled>⏱ Seçili Maçın Öğrenci Sürelerini Aç</button>
            <button class="btn" onclick="renderSureAnaEkran()">↻ Maçları Yenile</button>
            <button class="btn" style="background:#475569" onclick="anaMenu()">← Ana Menü</button>
            <div id="sureModalHost" class="no-print"></div>
        </div>`;
        try {
            const [mSnap,fixture]=await Promise.all([
                db.ref('maclar/'+kategori).once('value'),
                puanlamaFiksturMaclariniOku().catch(()=>[])
            ]);
            if(id!==sureHizliEkranSurumu || !document.getElementById('sureHizliMacSec'))return;
            const fromDB={};mSnap.forEach(c=>{fromDB[c.key]=c.val();});
            const matches=new Map();
            for(const f of fixture){
                if(f.cat!==(kategori==='LİSE'?'lise':'ortaokul') || !puanlamaGecerliFiksturMaci(f))continue;
                const mid=macKimligiOlustur(kategori,f.team1,f.team2);
                matches.set(mid,{...puanlamaFiksturMacKaydi(f),...(fromDB[mid]||{}),id:mid});
            }
            for(const [mid,m] of Object.entries(fromDB)){
                if(!m?.hukOkul||!m?.muhOkul||matches.has(mid))continue;
                matches.set(mid,{...m,id:mid});
            }
            sureHizliMaclar=matches;
            // Henüz Firebase'de operasyon kaydı olmayan resmî fikstür maçları için
            // yoneticiMaciniHazirla() bu liste üzerinden güvenli kayıt oluşturabilir.
            yoneticiFiksturMaclari=[...matches.values()];
            const arr=[...matches.values()].filter(m=>m.hukOkul&&m.muhOkul && !m.isPending && !['boş','bay'].includes(fiksturIstisnaNorm(m.hukOkul)) && !['boş','bay'].includes(fiksturIstisnaNorm(m.muhOkul)))
                .sort((a,b)=>(Number(a.fiksturNo)||9999)-(Number(b.fiksturNo)||9999));
            const sel=document.getElementById('sureHizliMacSec');
            sel.innerHTML='<option value="">Bir maç seçiniz</option>'+arr.map(m=>`<option value="${htmlEscape(m.id)}">${m.fiksturNo?'#'+m.fiksturNo+' · ':''}${htmlEscape(m.hukOkul)} — ${htmlEscape(m.muhOkul)}${m.durum==='kapali'?' [KAPALI]':m.durum==='iptal'?' [İPTAL]':''}</option>`).join('');
            const note=document.getElementById('sureHizliBilgi');
            if(note)note.textContent=`${arr.length} maç listelendi. Maçı seçip süre ekranını açın. Eksik veya belirsiz öğrenci listesinde seçim onayı istenir.`;
        }catch(err){const note=document.getElementById('sureHizliBilgi');if(note)note.textContent='Maçlar yüklenemedi: '+String(err?.message||err);}
    }
    function sureHizliSecimiGuncelle(){
        const mid=document.getElementById('sureHizliMacSec')?.value||'';
        const m=sureHizliMaclar.get(mid);
        const btn=document.getElementById('sureHizliAcBtn');if(btn)btn.disabled=!m||m.durum==='iptal'||(m.durum==='kapali'&&!sureKapanmisMacKaydiIzni(m));
        const info=document.getElementById('sureHizliBilgi');
        if(info && m)info.textContent=m.durum==='kapali'
            ? (sureKapanmisMacKaydiIzni(m)?'Maç kesinleşmiş: süreleri tutanak için ekleyebilir/düzeltebilirsiniz; galip değişmeyecek.':'Maç iptal/sonuçsuz olduğundan süre girişi kapalı.')
            :'Seçilen maç: '+m.hukOkul+' / '+m.muhOkul+'. Öğrenciler Firebase kadrolarından otomatik getirilecek.';
    }
    async function sureHizliAc(){
        const mid=document.getElementById('sureHizliMacSec')?.value||'';
        const m=sureHizliMaclar.get(mid);
        if(!m)return alert('Önce bir maç seçin.');
        if(m.durum==='iptal'||(m.durum==='kapali'&&!sureKapanmisMacKaydiIzni(m)))return alert('Bu maçın süre kaydına izin verilmiyor.');
        await sureModalAc(secimler.kategori,mid);
    }
    let aktifSureModal=null;
    let sureTickTimer=null;
    let sureTiklayanTaraf=null;
    let sureBaslangicAni=0;
    let sureTabanSaniye=0;

    function sureAlaniniCoz(text) {
        return String(text).trim()==='00:00'?0:sureMetniniCoz(text);
    }
    function sureAktifSayaciDurdur() {
        if(!sureTiklayanTaraf)return;
        const saniye=sureTabanSaniye+Math.floor((performance.now()-sureBaslangicAni)/1000);
        const input=document.getElementById(`sureTakim${sureTiklayanTaraf}`);
        if(input)input.value=sureyiMetneDonustur(saniye);
        sureTiklayanTaraf=null;
        if(sureTickTimer)clearInterval(sureTickTimer);
        sureTickTimer=null;
        document.querySelectorAll('.sure-sayac-btn').forEach(el=>el.textContent='▶ Başlat');
        sureTakimToplamlariniGuncelle();
    }
    function sureTakimToplamlariniGuncelle() {
        if(!aktifSureModal)return;
        for(const taraf of ['huk','muh']){
            const adlar=aktifSureModal.ogrenciler[taraf]||[];
            let toplam=0,hatali=0;
            adlar.forEach((_,i)=>{
                const t=sureAlaniniCoz(document.getElementById(`sureTakim${taraf}_${i}`)?.value||'');
                if(t===null)hatali++;
                else toplam+=t;
            });
            const lbl=document.getElementById(`sureToplam_${taraf}`);
            if(lbl)lbl.textContent=hatali?'Geçersiz süre':sureyiMetneDonustur(toplam);
        }
    }
    function sureSayaçGuncelle() {
        if(!sureTiklayanTaraf)return;
        const saniye=sureTabanSaniye+Math.floor((performance.now()-sureBaslangicAni)/1000);
        const input=document.getElementById(`sureTakim${sureTiklayanTaraf}`);
        if(input)input.value=sureyiMetneDonustur(saniye);
        sureTakimToplamlariniGuncelle();
    }
    function sureSayaciniDegistir(anahtar) {
        if(!aktifSureModal)return;
        if(sureTiklayanTaraf===anahtar)return sureAktifSayaciDurdur();
        if(sureTiklayanTaraf)return alert('Önce çalışan diğer öğrenci sayacını durdurun.');
        const input=document.getElementById(`sureTakim${anahtar}`);
        const eski=sureAlaniniCoz(input?.value||'');
        if(eski===null)return alert('Süre biçimi dakika:saniye (örnek 02:35) olmalı.');
        sureTabanSaniye=eski;
        sureBaslangicAni=performance.now();
        sureTiklayanTaraf=anahtar;
        const btn=document.getElementById(`sureBaslat${anahtar}`);
        if(btn)btn.textContent='⏸ Duraklat';
        sureTickTimer=setInterval(sureSayaçGuncelle,300);
    }
    function sureModalKapat() {
        sureAktifSayaciDurdur();
        aktifSureModal=null;
        sureKurtarmaBaglam=null;
        const host=document.getElementById('sureModalHost');
        if(host)host.innerHTML='';
    }
    // V3.10 - Oynanmış maçın öğrenci listesi kaynağı farklı adla kayıtlıysa
    // süreler için kayıtlı listeden veya BU MAÇIN mevcut jüri puanlarından güvenli kurtarma.
    // Yalnızca seçilen maça ait puanlar okunur; puanlar ve fikstür asla değiştirilmez.
    let sureKurtarmaBaglam=null;
    function surePuandanOgrenciListesi(snapshot,macId) {
        const sonuc={huk:[],muh:[]}, seen={huk:new Set(),muh:new Set()};
        if(!snapshot)return sonuc;
        snapshot.forEach(c=>{
            const v=c.val(), sec=v?.secim||{};
            if(!v||kayitMacId(v)!==macId)return;
            const taraf=sec.taraf==='HÜKÜMET'?'huk':sec.taraf==='MUHALEFET'?'muh':'';
            if(!taraf)return;
            const tam=puanMetniNormalize(sec.ogr);
            const ad=tam.replace(/\s*\((?:[1-9]\d*\.\s*Konuşmacı|Grup Sözcüsü)\)\s*$/iu,'').trim();
            const key=skorEslesmeAnahtari(ad);
            if(!key||seen[taraf].has(key))return;
            seen[taraf].add(key);
            const n=Number(tam.match(/\((\d+)\.\s*Konuşmacı\)/iu)?.[1]||999);
            sonuc[taraf].push({ad,sira:n});
        });
        for(const taraf of ['huk','muh'])sonuc[taraf].sort((a,b)=>a.sira-b.sira||a.ad.localeCompare(b.ad,'tr'));
        return {huk:sonuc.huk.map(x=>x.ad),muh:sonuc.muh.map(x=>x.ad)};
    }
    function sureKurtarmaBaslat(baglam){
        sureKurtarmaBaglam=baglam;
        const {kategori,mac,okullar,puandan}=baglam;
        const keys=Object.keys(okullar).filter(k=>okullar[k]?.length).sort((a,b)=>a.localeCompare(b,'tr'));
        const defaultKaynak={};
        for(const taraf of ['huk','muh']){
            const okul=taraf==='huk'?mac.hukOkul:mac.muhOkul;
            const kaynak=mac.ogrenciKaynaklari?.[taraf]||okul;
            const iki=keys.filter(k=>guvenliOkulAnahtari(k)===guvenliOkulAnahtari(kaynak));
            const dogrudan=keys.filter(k=>guvenliOkulAnahtari(k)===guvenliOkulAnahtari(okul));
            defaultKaynak[taraf]=iki.length===1?iki[0]:dogrudan.length===1?dogrudan[0]:'';
        }
        // En güvenilir kaynak: doğru okul adındaki kadro. Maçta jüri puanı varsa
        // otomatik seçim bu öğrencilerin tamamını kapsamalıdır.
        const kapsiyor=(taraf,kaynak)=>{
            const roster=okullar[kaynak]||[];
            const keys=new Set(roster.map(skorEslesmeAnahtari));
            return roster.length>0 && (puandan[taraf]||[]).every(ad=>keys.has(skorEslesmeAnahtari(ad)));
        };
        for(const taraf of ['huk','muh']){
            const okul=taraf==='huk'?mac.hukOkul:mac.muhOkul;
            const adayTam=keys.filter(k=>guvenliOkulAnahtari(k)===guvenliOkulAnahtari(okul));
            const tam=adayTam.length===1?adayTam[0]:'';
            if(tam && kapsiyor(taraf,tam)) defaultKaynak[taraf]=tam;
            else if(defaultKaynak[taraf] && !kapsiyor(taraf,defaultKaynak[taraf])) defaultKaynak[taraf]='';
            // Tam isim bulunmazsa, puanlanmış öğrencilerin tümünü içeren TEK kadroyu kullan.
            if(!defaultKaynak[taraf] && (puandan[taraf]||[]).length){
                const adaylar=keys.filter(k=>kapsiyor(taraf,k));
                if(adaylar.length===1) defaultKaynak[taraf]=adaylar[0];
            }
        }
        if(defaultKaynak.huk&&defaultKaynak.muh && defaultKaynak.huk!==defaultKaynak.muh){
            sureSureFormuGoster(baglam,{huk:okullar[defaultKaynak.huk],muh:okullar[defaultKaynak.muh]},defaultKaynak);
            return;
        }
        const secici=taraf=>{
            const okul=taraf==='huk'?mac.hukOkul:mac.muhOkul;
            const value=defaultKaynak[taraf];
            const opts=keys.map(key=>`<option value="${htmlEscape(key)}" ${value===key?'selected':''}>${htmlEscape(key)} — ${okullar[key].length} öğrenci</option>`).join('');
            const scor=puandan[taraf]?.length||0;
            return `<div class="sure-team"><strong>${htmlEscape(okul)} (${taraf==='huk'?'Hükümet':'Muhalefet'})</strong>
                <p class="sure-hint">${value?'Kayıtlı öğrenci listesi bulundu.':'Fikstürdeki adla eşleşen liste yok.'} Aşağıdan gerçekte yarışan okulun öğrenci listesini seçin.</p>
                <select id="sureKurtarma_${taraf}" aria-label="${htmlEscape(okul)} öğrenci kaynağı" onchange="sureKurtarmaOnizle()">
                <option value="">Öğrenci listesi seçin</option>${opts}
                ${scor?`<option value="__PUAN__">⭐ Bu maçta jüri puanı girilmiş ${scor} öğrenci</option>`:''}
                </select><div id="sureKurtarmaListe_${taraf}" class="sure-hint"></div></div>`;
        };
        const host=document.getElementById('sureModalHost');if(!host)return;
        host.innerHTML=`<div class="sure-modal-bg" role="dialog" aria-modal="true" aria-label="Öğrenci listesi kurtarma"><div class="sure-modal-card" style="width:min(950px,98vw)">
            <h2>⏱ Öğrenci Listesi Bulunamadı — Güvenli Süre Kurtarma</h2>
            <div class="puanlama-bilgi hata">Bu hata öğrencilerin silindiği anlamına gelmez. Resmî fikstürdeki okul adı ile Firebase'deki öğrenci listesinin adı farklı olabilir. Kategori: <b>${htmlEscape(kategori)}</b>.</div>
            <p class="sure-hint">Yalnızca yarışmış iki okulun <b>gerçek öğrenci listesini</b> seçin; seçeneklerin altındaki isimleri kontrol edin. İlgili okul kayıtları görünmüyorsa aynı maça kaydedilmiş jüri puanlarından öğrencileri seçebilirsiniz. Bu, puanları ve maç eşleşmesini değiştirmez. Jüri puanından getirilen liste eksikse süreleri kaydetmeden önce kontrol edin.</p>
            <div class="sure-student-grid">${secici('huk')}${secici('muh')}</div>
            <button class="btn" style="background:#0369a1" onclick="sureKurtarmayiUygula()">✓ Öğrenci Listelerini Doğrula ve Süreyi Aç</button>
            <button class="btn" onclick="sureModalKapat()">Kapat (Verileri Değiştirme)</button>
        </div></div>`;
        sureKurtarmaOnizle();
    }
    function sureKurtarmaOnizle(){
        if(!sureKurtarmaBaglam)return;
        for(const taraf of ['huk','muh']){
            const key=document.getElementById('sureKurtarma_'+taraf)?.value||'';
            const el=document.getElementById('sureKurtarmaListe_'+taraf);if(!el)continue;
            const arr=key==='__PUAN__'?sureKurtarmaBaglam.puandan[taraf]:(sureKurtarmaBaglam.okullar[key]||[]);
            el.textContent=arr.length?arr.map((a,i)=>`${i+1}. ${a}`).join(' · '):'Henüz bir liste seçilmedi.';
        }
    }
    function sureKurtarmayiUygula(){
        const b=sureKurtarmaBaglam;if(!b)return alert('Süre ekranını yeniden açın.');
        const kaynaklar={huk:document.getElementById('sureKurtarma_huk')?.value||'',muh:document.getElementById('sureKurtarma_muh')?.value||''};
        if(!kaynaklar.huk||!kaynaklar.muh)return alert('Her iki okulun gerçek öğrenci listesini seçmelisiniz.');
        if(kaynaklar.huk===kaynaklar.muh&&kaynaklar.huk!=='__PUAN__')return alert('İki okul aynı öğrenci listesine bağlanamaz.');
        const ogrenciler={};
        for(const taraf of ['huk','muh']){
            ogrenciler[taraf]=kaynaklar[taraf]==='__PUAN__'?b.puandan[taraf]:(b.okullar[kaynaklar[taraf]]||[]);
            if(!ogrenciler[taraf].length)return alert('Seçilen kaynakta öğrenci bulunamadı.');
            const keys=new Set(ogrenciler[taraf].map(skorEslesmeAnahtari));
            const eksik=(b.puandan[taraf]||[]).filter(ad=>!keys.has(skorEslesmeAnahtari(ad)));
            if(eksik.length)return alert(`${taraf==='huk'?b.mac.hukOkul:b.mac.muhOkul} için seçilen liste, bu maçta jüri puanı bulunan şu öğrencileri içermiyor: ${eksik.join(', ')}. Doğru listeyi seçin veya 'Bu maçta jüri puanı girilmiş öğrenciler' seçeneğini kullanın.`);
            if(new Set(ogrenciler[taraf].map(skorEslesmeAnahtari)).size!==ogrenciler[taraf].length)
                return alert('Seçilen listede mükerrer öğrenci adları var. Kaydı kontrol edin.');
        }
        if(!confirm(`Süre kaydında kullanılacak gerçek öğrencileri onaylıyor musunuz?\n${b.mac.hukOkul}: ${ogrenciler.huk.join(', ')}\n${b.mac.muhOkul}: ${ogrenciler.muh.join(', ')}\n\nJüri puanları, fikstür ve okul kayıtları değiştirilmeyecek.`))return;
        sureSureFormuGoster(b,ogrenciler,kaynaklar);
    }
    // Kapanmış, puan farkıyla kazanılmış maçta ilk süre belgesi sonucu etkilemez.
    // Puan eşitliğiyle kapanmış, hükmen bitmiş veya iptal edilmiş maça dokunulmaz.
    function otomatikSureleriDerle(m){
        const list={huk:new Map(),muh:new Map()};
        for(const v of Object.values(m?.konusmaSayaclari||{})){
            if(!v?.ogrenci)continue;
            const s=ortakSureKalan(v);
            if(!s?.bitti)continue;
            let taraf=v.taraf==='HÜKÜMET'?'huk':v.taraf==='MUHALEFET'?'muh':'';
            const okulKey=guvenliOkulAnahtari(v.okul);
            if(okulKey===guvenliOkulAnahtari(m.hukOkul))taraf='huk';
            else if(okulKey===guvenliOkulAnahtari(m.muhOkul))taraf='muh';
            if(!taraf)continue;
            const ad=String(v.ogrenci).split(' (')[0].trim(),key=skorEslesmeAnahtari(ad);
            const old=list[taraf].get(key);
            const data={ad,saniye:s.gecen,bitisAt:Number(v.bitisAt)||Number(v.baslangicAt||0)+s.gecen*1000};
            if(!old||data.bitisAt>old.bitisAt)list[taraf].set(key,data);
        }
        const ogrenciler={huk:[],muh:[]},toplam={huk:0,muh:0};
        for(const taraf of ['huk','muh']){
            ogrenciler[taraf]=[...list[taraf].values()].map(x=>({ad:x.ad,saniye:x.saniye}));
            toplam[taraf]=ogrenciler[taraf].reduce((n,x)=>n+x.saniye,0);
        }
        return {ogrenciler,toplam,sayi:ogrenciler.huk.length+ogrenciler.muh.length};
    }
    // Bu işlem ayrı jüri puanlarına ve resmî maç sonucuna dokunmaz.
    // Kullanıcı tarafından girilmiş süreyi otomatik veriyle ASLA ezmez.
    const sureEsitlemeDevam=new Set();
    async function otomatikSureleriKaydet(kategori,macId){
        const key=kategori+'|'+macId;
        if(sureEsitlemeDevam.has(key)||!firebaseBagli||!navigator.onLine)return;
        sureEsitlemeDevam.add(key);
        try{
            const result=await db.ref(`maclar/${kategori}/${macId}`).transaction(cur=>{
                if(!cur)return;
                const o=otomatikSureleriDerle(cur);
                if(!o.sayi||cur.sureEsitlik?.kaynak==='manuel' ||
                    (cur.sureEsitlik?.ogrenciler && cur.sureEsitlik?.kaynak!=='otomatik'))return;
                const eski=cur.sureEsitlik||{};
                const ayni=JSON.stringify(eski.ogrenciler||{})===JSON.stringify(o.ogrenciler)
                    && eski.hukSaniye===o.toplam.huk && eski.muhSaniye===o.toplam.muh;
                if(ayni)return;
                cur.sureEsitlik={...eski,kaynak:'otomatik',hukOkul:cur.hukOkul,muhOkul:cur.muhOkul,
                    hukSaniye:o.toplam.huk,muhSaniye:o.toplam.muh,ogrenciler:o.ogrenciler,
                    updatedAt:Date.now()};
                return cur;
            },undefined,false);
            if(result.committed&&result.snapshot.val()?.sureEsitlik)
                await macSureYedeginiKaydet(kategori,macId,result.snapshot.val().sureEsitlik,'otomatik_sure_hesaplama');
        }catch(e){console.warn('Otomatik konuşma süresi toplama:',e);}
        finally{sureEsitlemeDevam.delete(key);}
    }
    function sureKapanmisMacKaydiIzni(m){
        return !!m && m.durum==='kapali' && !!m.sonuc &&
            (!!m.sonuc.kazanan || m.sonuc.yontem==='cift_eleme');
    }
    function sureSureFormuGoster(baglam,ogrenciler,kaynaklar){
        const {kategori,macId,mac:m}=baglam;
            const saltOkunur=m.durum==='kapali' && !adminYetkiliMi(); // Kapalı maçı yalnız yönetici düzeltebilir.
            aktifSureModal={kategori,macId,mac:m,ogrenciler,kaynaklar,
                oncekiGuncelleme:m.sureEsitlik?.updatedAt||0};
            const host=document.getElementById('sureModalHost');
            if(!host)return;
            const panel=(taraf,okul)=>{
                const eski=m.sureEsitlik?.ogrenciler?.[taraf]||[];
                return `<div class="sure-team"><strong>${htmlEscape(okul)} (${taraf==='huk'?'Hükümet':'Muhalefet'})</strong>
                    ${ogrenciler[taraf].map((ad,i)=>{
                        const v=eski.find(x=>skorEslesmeAnahtari(x.ad)===skorEslesmeAnahtari(ad));
                        const otomatik=m.konusmaSayaclari?.[ortakSureKimligi(okul,ad)] ||
                            Object.values(m.konusmaSayaclari||{}).find(x=>
                                skorEslesmeAnahtari(x?.ogrenci)===skorEslesmeAnahtari(ad) &&
                                (x.taraf===(taraf==='huk'?'HÜKÜMET':'MUHALEFET') || skorEslesmeAnahtari(x.okul)===skorEslesmeAnahtari(okul)));
                        const otomatikSure=ortakSureKalan(otomatik);
                        const value=v&&Number.isInteger(v.saniye)?v.saniye:(otomatikSure?.bitti?otomatikSure.gecen:0);
                        const id=taraf+'_'+i;
                        return `<div class="sure-student-row"><span class="sure-student-name">${i+1}. ${htmlEscape(ad)}</span>
                            <input id="sureTakim${id}" value="${sureyiMetneDonustur(value)}" inputmode="numeric" aria-label="${htmlEscape(ad)} konuşma süresi" oninput="sureTakimToplamlariniGuncelle()" ${saltOkunur?'disabled':''}>
                            <button class="btn sure-sayac-btn" id="sureBaslat${id}" onclick="sureSayaciniDegistir('${id}')" ${saltOkunur?'disabled':''}>▶ Başlat</button></div>`;
                    }).join('')}
                    <div class="sure-hint"><b>Okul toplamı: <span id="sureToplam_${taraf}">00:00</span></b></div></div>`;
            };
            host.innerHTML=`<div class="sure-modal-bg" role="dialog" aria-modal="true" aria-label="Öğrenci bazlı süre kaydı"><div class="sure-modal-card" style="width:min(950px,98vw)">
                <h2>⏱ Öğrenci Bazlı Konuşma Süreleri</h2>
                ${kaynaklar.huk!==m.hukOkul||kaynaklar.muh!==m.muhOkul?`<div class="puanlama-bilgi">Öğrenci listesi kaynakları: ${htmlEscape(m.hukOkul)} → ${htmlEscape(kaynaklar.huk==='__PUAN__'?'Kaydedilmiş jüri puanları':kaynaklar.huk)} · ${htmlEscape(m.muhOkul)} → ${htmlEscape(kaynaklar.muh==='__PUAN__'?'Kaydedilmiş jüri puanları':kaynaklar.muh)}. <b>Bu süre kaydı puanları veya fikstürü değiştirmez.</b></div>`:''}
                ${m.durum==='kapali'?`<div class="puanlama-bilgi">Bu maç kesinleşmiş: ${saltOkunur?'Jüri cihazında yalnız görüntülenir. Geriye dönük düzeltme için Yönetici Modülüne girin.':'süreler geriye dönük tutanak için eklenebilir/düzeltilebilir.'} <b>Galip, puanlar ve resmî fikstür değişmez.</b> Düzeltmeler ayrıca arşivlenir.</div>`:''}
                <p class="sure-hint">Tamamlanan ortak sayaçlar öğrenci bazında otomatik kaydedilir ve iki takım toplamı hesaplanır. Bu pencere <b>eksik/eski süreleri düzeltmek</b> içindir. Kaydet düğmesi manuel onay/düzeltme yapar. Konuşmayan öğrenci 00:00 kalabilir; her okulun toplamı sıfırdan büyük olmalıdır.</p>
                <div class="sure-student-grid">${panel('huk',m.hukOkul)}${panel('muh',m.muhOkul)}</div>
                <p class="sure-hint">Puan eşitliğinde, toplam konuşma süresi daha kısa olan okul galip sayılır. Süreler yeniden kaydedilirse tüm öğrenci kayıtları bir arada güncellenir.</p>
                ${saltOkunur?'':`<button class="btn" style="background:var(--success)" onclick="sureFirebaseKaydet()">☁ Öğrenci Sürelerini Kaydet</button>`}
                <button class="btn" onclick="sureModalKapat()">Kapat</button>
                </div></div>`;
            sureTakimToplamlariniGuncelle();
    }
    async function sureModalAc(kategori,macId) {
        // Öğrenci süresi girişinde yönetici oturumu istenmez.
        if(!navigator.onLine||!firebaseBagli)return alert('Süre kaydı için Firebase bağlantısı gerekli.');
        try {
            const m=await yoneticiMaciniHazirla(kategori,macId);
            if(!m?.hukOkul||!m?.muhOkul)throw new Error('Maçın iki okulu bulunamadı.');
            if(m.durum!=='acik' && !sureKapanmisMacKaydiIzni(m))throw new Error('İptal/sonuçsuz maçların süresi değiştirilemez.');
            const [oSnap,pSnap]=await Promise.all([
                db.ref('okullar/'+kategori).once('value'),db.ref('puanlar/'+kategori).once('value')
            ]);
            const okullar=puanlamaRosteriGetir(oSnap);
            const puandan=surePuandanOgrenciListesi(pSnap,macId);
            sureModalKapat();
            sureKurtarmaBaslat({kategori,macId,mac:m,okullar,puandan});
        }catch(err){alert('Süre ekranı açılamadı: '+(err?.message||err));}
    }
    async function sureFirebaseKaydet() {
        if(!aktifSureModal||!navigator.onLine||!firebaseBagli)return alert('Süre kaydı için Firebase bağlantısı gereklidir.');
        sureAktifSayaciDurdur();
        const {kategori,macId,mac,oncekiGuncelleme,ogrenciler,kaynaklar}=aktifSureModal;
        const detay={huk:[],muh:[]};const toplam={huk:0,muh:0};
        for(const taraf of ['huk','muh']){
            for(let i=0;i<ogrenciler[taraf].length;i++){
                const text=document.getElementById(`sureTakim${taraf}_${i}`)?.value||'';
                const sn=sureAlaniniCoz(text);
                if(sn===null)return alert(ogrenciler[taraf][i]+' için süre geçersiz. Biçim dakika:saniye (örnek 03:25) olmalı.');
                detay[taraf].push({ad:ogrenciler[taraf][i],saniye:sn});toplam[taraf]+=sn;
            }
            if(!toplam[taraf])return alert((taraf==='huk'?mac.hukOkul:mac.muhOkul)+' toplam süresi 00:00 olamaz.');
        }
        const kapaliBelgeleme=mac.durum==='kapali' && sureKapanmisMacKaydiIzni(mac);
        if(kapaliBelgeleme&&!adminYetkiliMi())return alert('Kesinleşmiş maçın süresini yalnız yetkili yönetici düzeltebilir.');
        if(mac.durum==='kapali'&&!kapaliBelgeleme)return alert('Bu kapalı maçın sonucu doğrulanamadı.');
        if(kapaliBelgeleme && !confirm('KESİNLEŞMİŞ MAÇ · GERİYE DÖNÜK SÜRE BELGESİ\n\nBu kayıtta yalnız öğrenci konuşma süreleri güncellenecek. Galip, jüri puanları ve resmî fikstür sonucu değişmeyecek. Denetim kaydı oluşturulacak. Devam edilsin mi?'))return;
        const auditRef=kapaliBelgeleme?db.ref(`arsiv/sureDuzeltmeleri/${kategori}/${Date.now()}_${macId}`):null;
        if(auditRef){
            try{await auditRef.set({macId,kategori,islem:'kapali_maca_geriye_donuk_sure_belgesi',
                oncekiSure:mac.sureEsitlik||null,sonrakiSure:{ogrenciler:detay,toplam},
                orijinalSonuc:mac.sonuc,createdAt:firebase.database.ServerValue.TIMESTAMP,durum:'bekliyor'});}
            catch(e){return alert('Denetim kaydı oluşturulamadı; süre değiştirilmedi: '+String(e?.message||e));}
        }
        try{
            if(mac.sureEsitlik)await macSureYedeginiKaydet(kategori,macId,mac.sureEsitlik,'manuel_sure_degisim_oncesi')
                .catch(e=>console.warn('Önceki süre yedeği alınamadı:',e));
            const r=await db.ref(`maclar/${kategori}/${macId}`).transaction(cur=>{
                if(!cur||skorEslesmeAnahtari(cur.hukOkul)!==skorEslesmeAnahtari(mac.hukOkul)||skorEslesmeAnahtari(cur.muhOkul)!==skorEslesmeAnahtari(mac.muhOkul))return;
                if(kapaliBelgeleme){
                    if(cur.durum!=='kapali'||!sureKapanmisMacKaydiIzni(cur)||
                        JSON.stringify(cur.sonuc||{})!==JSON.stringify(mac.sonuc||{}))return;
                }else if(cur.durum!=='acik')return;
                if((cur.sureEsitlik?.updatedAt||0)!==oncekiGuncelleme)return;
                cur.sureEsitlik={hukOkul:cur.hukOkul,muhOkul:cur.muhOkul,hukSaniye:toplam.huk,muhSaniye:toplam.muh,ogrenciler:detay,
                        kaynak:'manuel',kaynaklar:{huk:aktifSureModal.kaynaklar.huk,muh:aktifSureModal.kaynaklar.muh},updatedAt:Date.now()};
                // Doğrulanmış liste eşleştirmesini aynı maçta sonraki ekranda tekrar sorma.
                cur.ogrenciKaynaklari={...cur.ogrenciKaynaklari};
                for(const taraf of ['huk','muh'])if(kaynaklar[taraf]&&kaynaklar[taraf]!=='__PUAN__')
                    cur.ogrenciKaynaklari[taraf]=kaynaklar[taraf];
                cur.updatedAt=Date.now();return cur;
            },undefined,false);
            if(!r.committed)return alert('Süre kaydı başka cihazda değişti veya maç kapatıldı. Tekrar açıp kontrol edin.');
            await macSureYedeginiKaydet(kategori,macId,r.snapshot.val()?.sureEsitlik,'manuel_sure_guncellemesi')
                .catch(e=>console.warn('Manuel süre yedeği yazılamadı:',e));
            sureModalKapat();
            if(auditRef){
                try{await auditRef.update({durum:'kaydedildi',kayitAt:firebase.database.ServerValue.TIMESTAMP});}
                catch(e){console.warn('Süre değişikliği denetim durum güncellenemedi',e);}
            }
            alert(`Öğrenci süreleri kaydedildi. ${mac.hukOkul}: ${sureyiMetneDonustur(toplam.huk)} · ${mac.muhOkul}: ${sureyiMetneDonustur(toplam.muh)}`+
                (!kapaliBelgeleme && (kaynaklar.huk!==mac.hukOkul||kaynaklar.muh!==mac.muhOkul)?'\n\nÖnemli: Bu yalnızca SÜRE kaydıdır. Maç kesinleştirmede öğrenci listesi uyuşmazlığı çıkarsa Yönetici → Okullar ve Öğrenciler → Öğrenci Listesi Eşleştirmeleri kısmında doğru listeleri doğrulayın.':''));
        }catch(err){alert('Süreler kaydedilemedi: '+(err?.message||err));}
    }

    function macTamamlamaOzeti(kayitlar, macId, m, okullar) {
        const secimlerMac=kayitlar.filter(v=>puanKaydiBuMacaAitMi(v,macId,m,m.kategori||secimler.kategori));
        // Skor okul etiketi fikstürden farklı yazılmışsa aynı maçın TARAF kaydı
        // öğrenciyi doğru eşler. Farklı maç ve karşı tarafa puan taşınmaz.
        const key=(taraf,ogr)=>`${taraf}|${skorEslesmeAnahtari(ogr)}`;
        const gruplar=new Map();
        for (const v of secimlerMac) {
            const s=v.secim||{};
            const taraf=puanKaydiTarafiniBul(v,m);
            if(!taraf)continue;
            const k=key(taraf,(s.ogr||'').split(' (')[0]);
            if(!gruplar.has(k)) gruplar.set(k,new Map());
            gruplar.get(k).set(s.juri,v);
        }
        const beklenen=[];
        for (const [taraf,okul] of [['huk',m.hukOkul],['muh',m.muhOkul]]) {
            const puanlanan=[...new Set(secimlerMac.filter(v=>puanKaydiTarafiniBul(v,m)===taraf)
                .map(v=>(v.secim?.ogr||'').split(' (')[0]).filter(Boolean))];
            const kaynak=guvenliKadroKaynagiBul(okullar,m,taraf,puanlanan);
            const ogrenciler=okullar[kaynak]||[];
            for (const ogr of ogrenciler) beklenen.push({okul,ogr,key:key(taraf,ogr)});
        }
        const sorunlar=[];
        const secilenKaynaklar=['huk','muh'].map(t=>guvenliKadroKaynagiBul(okullar,m,t,
            [...new Set(secimlerMac.filter(v=>puanKaydiTarafiniBul(v,m)===t)
                .map(v=>(v.secim?.ogr||'').split(' (')[0]).filter(Boolean))]));
        if(secilenKaynaklar[0] && secilenKaynaklar[0]===secilenKaynaklar[1])
            sorunlar.push('İki takım aynı öğrenci kadrosuna eşleştirilemez; manuel doğrulama gerekli.');
        if (!m.hukOkul || !m.muhOkul) sorunlar.push('İki okul tanımlı değil.');
        for(const taraf of ['huk','muh']){
            const okul=taraf==='huk'?m.hukOkul:m.muhOkul;
            const kayitlarTaraf=secimlerMac.filter(v=>puanKaydiTarafiniBul(v,m)===taraf);
            const adlar=[...new Set(kayitlarTaraf.map(v=>(v.secim?.ogr||'').split(' (')[0]).filter(Boolean))];
            if(!guvenliKadroKaynagiBul(okullar,m,taraf,adlar))
                sorunlar.push(`${okul}: doğrulanmış öğrenci kadrosu eşleşmesi bulunamadı. Kaynak belirsizse yönetici onayı gerekir.`);
        }
        const expectedKeys=new Set();
        for(const e of beklenen) {
            if(expectedKeys.has(e.key)) sorunlar.push(`Öğrenci ismi aynı okulda yineleniyor: ${e.ogr}`);
            expectedKeys.add(e.key);
        }
        const eksikler=new Set();
        let tam=0;
        const toplamlar={[m.hukOkul]:0,[m.muhOkul]:0};
        for (const e of beklenen) {
            const j=gruplar.get(e.key) || new Map();
            const fehl=BEKLENEN_JURILER.filter(role=>!j.has(role));
            fehl.forEach(role=>eksikler.add(role));
            if(fehl.length) { sorunlar.push(`${e.okul} / ${e.ogr}: eksik ${fehl.join(', ')}`);continue; }
            let good=true;
            for(const role of BEKLENEN_JURILER) {
                const v=j.get(role);
                if(!krit.every((k,i)=>{const p=Number(v?.puanlar?.[i]??v?.puanlar?.[String(i)]);return Number.isInteger(p)&&p>=1&&p<=k.m;})) {
                    good=false; sorunlar.push(`${e.okul} / ${e.ogr}: ${role} puanları eksik veya geçersiz.`);
                } else toplamlar[e.okul] += puanToplami(v);
            }
            if(good)tam++;
        }
        for(const [k,j] of gruplar) {
            if(!expectedKeys.has(k)) sorunlar.push(`Kayıtlı öğrenci listesinde olmayan puan kaydı: ${k}`);
            for(const role of j.keys()) if(!BEKLENEN_JURILER.includes(role)) sorunlar.push(`Geçersiz jüri numarası: ${role}`);
        }
        // Kadro kayıtları henüz bağlanmamış olsa da gerçekten puanlanan
        // öğrencilerin jüri durumu yöneticiden gizlenmez (0/0 yerine açıklamalı).
        const skorlanan=[...gruplar.values()];
        const skorlananTam=skorlanan.filter(j=>BEKLENEN_JURILER.every(role=>j.has(role))).length;
        const ready=beklenen.length>0 && sorunlar.length===0;
        return {ready,toplamlar,tam,eksik:beklenen.length-tam,total:beklenen.length,
            kayitliOgrenci:skorlanan.length,kayitliTam:skorlananTam,
            eksikRoller:[...eksikler],sorunlar};
    }

    // 3/3 jüri eksikken de Firebase'e kaydedilen puanlar yöneticiye görünmeli.
    // Bu ara toplam RESMÎ sonuç değildir; kesinleştirme 3/3 kontrolü eskisi gibi kalır.
    function kayitliJuriPuanlariniTopla(kayitlar,macId,m){
        const top={huk:0,muh:0,sayi:0};
        for(const v of kayitlar){
            if(!puanKaydiBuMacaAitMi(v,macId,m,m.kategori||secimler.kategori))continue;
            const taraf=puanKaydiTarafiniBul(v,m);
            if(!taraf)continue;
            const valid=krit.every((k,i)=>{
                const p=Number(v.puanlar?.[i]??v.puanlar?.[String(i)]);
                return Number.isInteger(p)&&p>=1&&p<=k.m;
            });
            if(!valid)continue;
            top[taraf]+=puanToplami(v);
            top.sayi++;
        }
        return top;
    }

    // Yönetici: resmî fikstürde yanlış seçilmiş galibi tek maç için düzeltir.
    // Tüm turnuvayı yeniden kurmaz ve jüri puanlarını silmez.
    async function yoneticiResmiGalibiDuzelt(kategori,macId){
      if(!adminYetkiliMi())return alert('Yönetici yetkisi gerekiyor.');
      const lock=`galip-duzelt:${kategori}:${macId}`;
      if(aktifSonucIslemleri.has(lock))return;
      aktifSonucIslemleri.add(lock);
      try{
        const macRef=db.ref(`maclar/${kategori}/${macId}`);
        const [mSnap,fSnap,tSnap]=await Promise.all([
          macRef.once('value'),db.ref('fikstur/tekSalon_2026_2027').once('value'),turnuvaRef(kategori).once('value')
        ]);
        const m=mSnap.val();
        if(!m||!m.hukOkul||!m.muhOkul)throw new Error('Maç kaydı veya okul adları bulunamadı.');
        const fixture=await fiksturEslesmesiniBul(kategori,m.hukOkul,m.muhOkul);
        const f=fSnap.val()||{};
        const finalized=f.finalizedMatches?.[fixture.no];
        if(finalized?.macId && finalized.macId!==macId)throw new Error('Bu resmî maç numarası başka bir maç kaydına bağlı. İşlem durduruldu.');
        const eskiGalip=f.winners?.[fixture.no]||finalized?.kazanan||m.sonuc?.kazanan||'';
        if(![m.hukOkul,m.muhOkul].some(x=>skorEslesmeAnahtari(x)===skorEslesmeAnahtari(eskiGalip)))
          throw new Error('Kayıtlı galip bu maçın iki okulundan biri değil. Otomatik düzeltme güvenli değil.');
        const secim=prompt(`YALNIZCA BU MAÇIN GALİBİNİ DÜZELT\n\n#${fixture.no} · ${m.hukOkul} / ${m.muhOkul}\nMevcut galip: ${eskiGalip}\n\n1 = ${m.hukOkul}\n2 = ${m.muhOkul}\n\nDoğru okulun numarasını yazın:`);
        if(secim===null)return;
        const yeniGalip=secim.trim()==='1'?m.hukOkul:secim.trim()==='2'?m.muhOkul:'';
        if(!yeniGalip)throw new Error('Yalnızca 1 veya 2 girin.');
        if(skorEslesmeAnahtari(yeniGalip)===skorEslesmeAnahtari(eskiGalip))return alert('Bu okul zaten galip kayıtlı; değişiklik yapılmadı.');
        const state=tSnap.val()||{};
        let kaynakTur=null, kaynakMac=null, sonrakiTur=null, sonrakiMac=null, treeHasRounds=!!state.rounds;
        if(treeHasRounds){
          for(const [rk,rr] of Object.entries(state.rounds||{}))for(const [mk,entry] of Object.entries(rr.matches||{})){
            if(entry.team2!=='BYE'&&okulCiftiEslesiyor(entry.team1,entry.team2,m.hukOkul,m.muhOkul)){kaynakTur=Number(String(rk).replace('r',''));kaynakMac=mk;}
          }
          const next= kaynakTur!==null ? state.rounds['r'+(kaynakTur+1)] : null;
          if(next){
            const matches=Object.entries(next.matches||{}).filter(([mk,e])=>[e.team1,e.team2].some(n=>skorEslesmeAnahtari(n)===skorEslesmeAnahtari(eskiGalip)));
            const duplicate=Object.values(next.matches||{}).some(e=>[e.team1,e.team2].some(n=>skorEslesmeAnahtari(n)===skorEslesmeAnahtari(yeniGalip)));
            if(matches.length!==1)throw new Error('Sonraki turda eski galibin bulunduğu tek bir eşleşme bulunamadı. Hiçbir kayıt değiştirilmedi.');
            if(duplicate)throw new Error('Doğru okul sonraki turda zaten kayıtlı. Çift kayıt oluşmaması için işlem durduruldu.');
            sonrakiTur=kaynakTur+1;sonrakiMac=matches[0][0];
          }
        }
        if(!confirm(`GALİBİ DÜZELTME ONAYI\n\nMaç #${fixture.no}\nEski galip: ${eskiGalip}\nYeni galip: ${yeniGalip}\n\nJüri puanları korunacak. Turnuva yeniden kurulmayacak. Diğer maçlara dokunulmayacak. Devam edilsin mi?`))return;
        // Denetim için önce eski değerlerin yedeğini al.
        await db.ref(`arsiv/galipDuzeltme/${kategori}/${Date.now()}_${fixture.no}`).set({macId,fixtureNo:fixture.no,eskiGalip,yeniGalip,macKaydi:m,eskiFikstur:f,eskiTurnuva:state,createdAt:Date.now()});
        const fr=await db.ref('fikstur/tekSalon_2026_2027').transaction(cur=>{
          if(!cur)return;
          const now=cur.finalizedMatches?.[fixture.no];
          if(now?.macId&&now.macId!==macId)return;
          if(cur.noWinnerMatches?.[fixture.no])return;
          const win=cur.winners?.[fixture.no];
          if(win&&skorEslesmeAnahtari(win)!==skorEslesmeAnahtari(eskiGalip))return;
          cur.winners=cur.winners||{};cur.winnerSources=cur.winnerSources||{};cur.finalizedMatches=cur.finalizedMatches||{};
          cur.winners[fixture.no]=yeniGalip;
          cur.winnerSources[fixture.no]={source:'yonetici_galip_duzeltme',updatedAt:Date.now(),macId};
          cur.finalizedMatches[fixture.no]={...(now||{}),macId,kategori,kazanan:yeniGalip,duzeltilenEskiGalip:eskiGalip,yontem:(now?.yontem||m.sonuc?.yontem||'puan'),updatedAt:Date.now(),closedAt:now?.closedAt||Date.now()};
          cur.updatedAt=Date.now();cur.sonIslem='yoneticiTekMacGalipDuzeltme';return cur;
        },undefined,false);
        if(!fr.committed)throw new Error('Resmî fikstür güncellemesi çakıştı. Güncel ekranı yenileyip tekrar kontrol edin.');
        const mr=await macRef.transaction(cur=>{
          if(!cur)return;
          if(cur.hukOkul!==m.hukOkul||cur.muhOkul!==m.muhOkul)return;
          cur.sonuc=cur.sonuc||{};cur.sonuc.kazanan=yeniGalip;cur.sonuc.maglup=skorEslesmeAnahtari(yeniGalip)===skorEslesmeAnahtari(cur.hukOkul)?cur.muhOkul:cur.hukOkul;
          cur.sonuc.yoneticiGalipDuzeltmesi={eskiGalip,yeniGalip,updatedAt:Date.now()};cur.sonuc.senkronDurum='tamam';cur.updatedAt=Date.now();cur.version=(cur.version||0)+1;return cur;
        },undefined,false);
        if(!mr.committed)throw new Error('Resmî fikstür güncellendi ancak maç kaydı eşitlenemedi. Yedek arşivde; ekranı yenileyip kontrol edin.');
        if(treeHasRounds){
          const tr=await turnuvaRef(kategori).transaction(cur=>{
            if(!cur?.rounds)return cur;
            cur.fiksturSonuclari=cur.fiksturSonuclari||{};
            const old=cur.fiksturSonuclari[fixture.no]||{};
            cur.fiksturSonuclari[fixture.no]={...old,macNo:fixture.no,macId,galip:yeniGalip,okul1:fixture.team1,okul2:fixture.team2,updatedAt:Date.now(),duzeltilenEskiGalip:eskiGalip};
            if(kaynakTur!==null&&cur.rounds['r'+kaynakTur]?.matches?.[kaynakMac]){
              const entry=cur.rounds['r'+kaynakTur].matches[kaynakMac];entry.winner=yeniGalip;entry.provisionalWinner=yeniGalip;entry.updatedAt=Date.now();
            }
            if(sonrakiTur!==null&&cur.rounds['r'+sonrakiTur]?.matches?.[sonrakiMac]){
              const entry=cur.rounds['r'+sonrakiTur].matches[sonrakiMac];
              if(skorEslesmeAnahtari(entry.team1)===skorEslesmeAnahtari(eskiGalip))entry.team1=yeniGalip;
              else if(skorEslesmeAnahtari(entry.team2)===skorEslesmeAnahtari(eskiGalip))entry.team2=yeniGalip;
              else return;
              // Bu maçın puanları/galibi yeni takımla yeniden değerlendirilmelidir.
              entry.score1=null;entry.score2=null;entry.winner='';entry.provisionalWinner='';entry.status='open';entry.updatedAt=Date.now();
            }
            cur.revision=(cur.revision||0)+1;cur.updatedAt=Date.now();cur.sonIslem='yoneticiTekMacGalipDuzeltme';return cur;
          },undefined,false);
          if(!tr.committed)throw new Error('Fikstür ve maç kaydı düzeltildi ancak merkezî ağaç güncellenemedi. Yedek arşivden kontrol edin.');
        }
        alert(`Galip düzeltildi.\n\nEski: ${eskiGalip}\nYeni: ${yeniGalip}\n\nJüri puanları korunmuştur. Diğer eşleşmeler yeniden kurulmadı.`);
        if(typeof yoneticiCanliPaneliYenile==='function')yoneticiCanliPaneliYenile();
      }catch(err){alert('Galip düzeltilemedi: '+(err?.message||err));}
      finally{aktifSonucIslemleri.delete(lock);}
    }

    function yoneticiMacArsivdeMi(row){
        const m=row?.m||{};
        return m.arsivlendi===true || !!row?.resmiSonuc ||
            (m.durum==='kapali' && !!m.sonuc);
    }

    function yoneticiMacSiralamaZamani(row){
        const key=raporFiksturTarihAnahtari(row?.m?.fiksturTarih||row?.m?.tarih||'');
        if(!key)return Number.MAX_SAFE_INTEGER;
        const [y,mo,d]=key.split('-').map(Number);
        const date=new Date(y,mo-1,d);
        const time=String(row?.m?.fiksturSaat||'').match(/(\d{1,2}):(\d{2})/);
        const minutes=time?Number(time[1])*60+Number(time[2]):1439;
        return date.getTime()+minutes*60000;
    }
    function yoneticiMacGorunumuSec(gorunum){
        if(!['aktif','arsiv'].includes(gorunum))return;
        yoneticiMacGorunumu=gorunum;
        if(yoneticiSonPanelVerileri)canliPaneliCiz(...yoneticiSonPanelVerileri);
    }

    function canliPaneliCiz(skorlar,maclar,okullar) {
        const inferred={...maclar};
        for(const f of yoneticiFiksturMaclari){
            if(inferred[f.id]){
                inferred[f.id]={...f,...inferred[f.id],id:f.id,kategori:f.kategori,
                    fiksturNo:inferred[f.id].fiksturNo||f.fiksturNo,
                    fiksturTarih:f.fiksturTarih||inferred[f.id].fiksturTarih||'',
                    fiksturSaat:f.fiksturSaat||inferred[f.id].fiksturSaat||''};
                continue;
            }
            const samePair=Object.entries(inferred).filter(([id,x])=>id!==f.id&&x?.hukOkul&&x?.muhOkul&&
                okulCiftiEslesiyor(x.hukOkul,x.muhOkul,f.hukOkul,f.muhOkul));
            if(samePair.length===1){
                const [oldId,old]=samePair[0];
                inferred[oldId]={...f,...old,id:oldId,kategori:f.kategori,
                    fiksturNo:old.fiksturNo||f.fiksturNo,
                    fiksturTarih:f.fiksturTarih||old.fiksturTarih||'',
                    fiksturSaat:f.fiksturSaat||old.fiksturSaat||''};
            }else inferred[f.id]={...f,_sanal:true};
        }
        skorlar.forEach(v=>{
            const id=kayitMacId(v);
            if(inferred[id])return;
            const pairMatches=Object.entries(inferred).filter(([key,m])=>
                puanKaydiBuMacaAitMi(v,key,m,secimler.kategori));
            if(pairMatches.length===1)return;
            inferred[id]={id,etiket:kayitMacEtiketi(v),hukOkul:v.secim?.hukOkul||'',muhOkul:v.secim?.muhOkul||'',kategori:v.secim?.kategori||v.kategori||secimler.kategori,durum:'acik'};
        });
        const rows=[];
        Object.entries(inferred).forEach(([id,m])=>{
            const takimMetni=[m?.hukOkul,m?.muhOkul].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
            if(m?.isPending || !m?.hukOkul || !m?.muhOkul ||
               /maç\s+galibi|tur\s+galibi|kura\s+beklen|belirlenecek|canlı\s+kura|protokol/.test(takimMetni) ||
               [m.hukOkul,m.muhOkul].some(x=>['boş','bay'].includes(fiksturIstisnaNorm(x))))return;
            const g=macTamamlamaOzeti(skorlar,id,m,okullar);
            const huk=Number(g.toplamlar[m.hukOkul]||0),muh=Number(g.toplamlar[m.muhOkul]||0);
            const sure=m.sureEsitlik||(()=>{
                const o=otomatikSureleriDerle(m);
                return o.sayi?{hukSaniye:o.toplam.huk,muhSaniye:o.toplam.muh,ogrenciler:o.ogrenciler,kaynak:'otomatik'}:null;
            })();
            const hamPuan=kayitliJuriPuanlariniTopla(skorlar,id,m);
            const resmiSonuc=canliResmiMacSonucu(m.fiksturNo||m.sonuc?.macNo,secimler.kategori);
            let durumText='Jüri eksik';
            if(m.durum==='iptal')durumText='İptal edildi · fikstür kaydı korunur';
            else if(m.durum==='kapali'&&m.sonuc?.yontem==='cift_eleme')durumText='⛔ İKİ OKUL ELENDİ · Galip yok · Üst tur düzenlenmeli';
            else if(m.sonuc?.kazanan&&m.durum==='kapali')durumText=`${m.sonuc.yoneticiIstisnasi?'YÖNETİCİ ONAYLI · ':m.sonuc.yontem==='hukmen'?'HÜKMEN · ':''}Galip: ${m.sonuc.kazanan}`;
            else if(resmiSonuc && m.durum!=='iptal')durumText=`✅ FİKSTÜRDE KESİNLEŞTİ · ${resmiSonuc.kazanan?'Galip: '+resmiSonuc.kazanan:'Galip yok'} · Arşivde`;
            else if(m.isPending || [m.hukOkul,m.muhOkul].some(n=>fiksturIstisnaNorm(n)==='boş'))durumText='⏳ RAKİP BEKLENİYOR · Maç ayrıldı, galip yok';
            else if(g.ready)durumText=huk!==muh?'Puanla galip belirlenebilir':(sure?.hukSaniye>0&&sure?.muhSaniye>0?(sure.hukSaniye!==sure.muhSaniye?'Süre üstünlüğü hazır':'Son savunma gerekli'):'BERABERLİK — süre girin');
            rows.push({id,m,...g,huk,muh,hamPuan,resmiSonuc,durumText});
        });
        rows.sort((a,b)=>Number(a.m.fiksturNo||99999)-Number(b.m.fiksturNo||99999)||(a.m.etiket||'').localeCompare(b.m.etiket||'','tr'));
        yoneticiSonPanelMacSatirlari=rows;
        const metrics=document.getElementById('liveMetrics');
        if(metrics){
            const noListesi=[...new Set(yoneticiFiksturMaclari.map(m=>Number(m.fiksturNo)).filter(n=>Number.isInteger(n)&&n>0))];
            const kesinlesen=noListesi.filter(no=>!!canliResmiMacSonucu(no,secimler.kategori)).length;
            const bekleyen=noListesi.length-kesinlesen;
            const tamMac=rows.filter(r=>r.ready).length;
            const q=Object.keys(offlineKuyrukGetir()).length;
            metrics.innerHTML=`<div class="admin-metric"><span>Resmî Fikstür Maçı</span><strong>${noListesi.length||'—'}</strong></div><div class="admin-metric"><span>Resmî Sonuç (Kesin / Bekleyen)</span><strong>${yoneticiResmiFiksturDurumu?kesinlesen+'/'+bekleyen:'Yükleniyor'}</strong></div><div class="admin-metric"><span>Jürisi Tam Maç</span><strong>${tamMac}</strong></div><div class="admin-metric"><span>Bu Cihaz Kuyruğu</span><strong>${q}</strong></div>`;
        }
        const div=document.getElementById('liveMatches');if(!div)return;
        const arsivdekiler=rows.filter(yoneticiMacArsivdeMi);
        const aktifler=rows.filter(r=>!yoneticiMacArsivdeMi(r));
        const gorunen=yoneticiMacGorunumu==='arsiv'?[...arsivdekiler]:[...aktifler];
        gorunen.sort((a,b)=>yoneticiMacSiralamaZamani(a)-yoneticiMacSiralamaZamani(b)||
            Number(a.m.fiksturNo||99999)-Number(b.m.fiksturNo||99999));

        const search=skorEslesmeAnahtari(document.getElementById('liveMatchSearch')?.value||'');
        const iptalGoster=document.getElementById('iptalGoster')?.checked||false;
        const bulunan=gorunen.filter(r=>(iptalGoster||r.m.durum!=='iptal')&&(!search||skorEslesmeAnahtari((r.m.fiksturNo||'')+' '+(r.m.etiket||macEtiketi(r.m.hukOkul,r.m.muhOkul))).includes(search)));
        const but=(text,cb,bg,disabled=false)=>`<button class="btn" style="padding:7px;margin:3px 0;background:${bg}" ${disabled?'disabled':''} onclick="${cb}">${text}</button>`;
        let html='<table class="tutanak-table"><tr><th>Maç</th><th>Durum</th><th>3/3 Tam</th><th>Kayıtlı Puan (H / M)</th><th>Süre (H / M)</th><th>Sonuç</th><th>Yönetici İşlemleri</th></tr>';
        bulunan.forEach(r=>{
            const kap=r.m.durum==='kapali',iptal=r.m.durum==='iptal',sure=r.m.sureEsitlik||(()=>{
                const o=otomatikSureleriDerle(r.m);
                return o.sayi?{hukSaniye:o.toplam.huk,muhSaniye:o.toplam.muh,kaynak:'otomatik'}:null;
            })();
            const state=r.resmiSonuc && !kap && !iptal?'Fikstür kesinleşmiş · otomatik arşivde':
                r.m.sonuc?.senkronDurum==='tamam'?'Eşitlendi':(kap&&r.m.sonuc?.senkronDurum==='fikstur_eslesme_gerekli'?'Fikstür eşleştirmesi gerekli':kap?'Senkron bekliyor':iptal?'İptal':'Açık');
            const tip=kap?'KAPALI':iptal?'İPTAL':r.resmiSonuc?'RESMÎ FİKSTÜR KESİN':'AÇIK';
            const kayitliSonuc=r.m.sonuc||{};
            const kesinPuan=kap&&Number.isFinite(kayitliSonuc.puanHuk)&&Number.isFinite(kayitliSonuc.puanMuh);
            const puan=kesinPuan?`${kayitliSonuc.puanHuk} / ${kayitliSonuc.puanMuh}`:(kap&&['hukmen','yonetici_karari','cift_eleme'].includes(kayitliSonuc.yontem)?'— / —':`${r.hamPuan.huk} / ${r.hamPuan.muh}`);
            const puanAciklamasi=kesinPuan?'Resmî sonuç':r.hamPuan.sayi?`${r.hamPuan.sayi} jüri kaydı · ${r.ready?'3/3 tamam':'kısmi toplam'}`:'Henüz jüri puanı yok';
            const f=`'${secimler.kategori}','${r.id}'`;
            let actions='';
            if(r.m.isPending || [r.m.hukOkul,r.m.muhOkul].some(n=>fiksturIstisnaNorm(n)==='boş')){
                actions+=but('✏ Rakibi Belirle',`renderFiksturIstisnaYonetimi()`,'#0f766e');
            } else if(iptal) actions+=but('↩ İptali Kaldır',`macIptaliniDegistir(${f},false)`,'#0f766e');
            else {
                if(!kap&&!r.resmiSonuc)actions+=but('✓ Sonucu Kesinleştir',`macDurumuDegistir(${f},'kapali')`,'#0f766e');
                let istisnalar='';
                if(!kap&&r.resmiSonuc){istisnalar+=but('✏ Resmî Galibi Düzelt',`yoneticiResmiGalibiDuzelt(${f})`,'#7c3aed');istisnalar+='<div class="sure-hint">Yalnız bu maçın galibi değiştirilir; diğer eşleşmelere dokunulmaz.</div>'; }
                if(kap&&r.m.sonuc?.senkronDurum!=='tamam'){istisnalar+=but('☁ Fikstür Senkronunu Onar',`macEsitlemeyiTekrarDene(${f})`,'#a16207');}
                istisnalar+=but('⏱ Süreleri Gör / Düzelt',`sureModalAc(${f})`,'#0369a1',kap && !sureKapanmisMacKaydiIzni(r.m));
                if(!kap){
                    if(!r.ready&&r.m.hukOkul&&r.m.muhOkul)
                        istisnalar+=but('🛟 Bulut Taslaklarını Tara / Kurtar',`yoneticiEksikJuriTaslaklariniKurtar('${secimler.kategori}','${r.id}')`,'#a16207');

                    istisnalar+=but('✏ Resmî Puanı Manuel Onayla',`yoneticiManuelSonucEkraniAc(${f})`,'#0f766e');
                    istisnalar+=but('⚖ Hükmen Sonuç',`macHukmenKapat(${f})`,'#a16207');
                    istisnalar+=but('⛔ İki Okul da Gelmedi',`macCiftElemeIleKapat(${f})`,'#9f1239');
                    istisnalar+=but('🛡 Gerekçeli Yönetici Kararı',`yoneticiKarariylaKapat(${f})`,'#6d28d9');
                    istisnalar+=but('✕ Maçı İptal Et',`macIptaliniDegistir(${f},true)`,'#475569');
                    if(!r.m._sanal)istisnalar+=but('🗑 Maç Kaydını Sil',`yoneticiMacKaydiniSil(${f})`,'#7f1d1d');
                }else{
                    istisnalar+=but('↩ Yeniden Aç (Sonucu Geri Al)',`macDurumuDegistir(${f},'acik')`,'#0f766e');
                    istisnalar+=but('🔗 Fikstürle Manuel Eşleştir',`yoneticiFiksturSonucEslestirEkraniAc(${f})`,'#0f766e');
                }
                actions+=`<details class="live-extras"><summary>⚙ İstisnai / gelişmiş işlemler</summary>${istisnalar}</details>`;
            }
            const idPrefix=r.m.fiksturNo?'#'+r.m.fiksturNo+' · ':'';
            html+=`<tr><td>${htmlEscape(idPrefix+(r.m.etiket||macEtiketi(r.m.hukOkul,r.m.muhOkul)))}</td><td class="${kap||iptal?'jury-missing':'jury-ok'}">${tip}<div style="font-size:10px">${state}</div></td><td class="${r.ready?'jury-ok':'jury-missing'}">${r.total?`${r.tam}/${r.total}`:`${r.kayitliTam}/${r.kayitliOgrenci}`}${!r.total&&r.kayitliOgrenci?'<div style="font-size:10px;color:#fbbf24">Puan kayıtlarından · kadro doğrulanmadı</div>':''}${r.eksik?`<div style="font-size:10px">${htmlEscape(r.eksikRoller.join(', '))}</div>`:''}</td><td class="sure-skor">${puan}<div style="font-size:10px;color:var(--text-muted);white-space:nowrap">${htmlEscape(puanAciklamasi)}</div></td><td class="sure-skor">${sure?.hukSaniye!=null?sureyiMetneDonustur(sure.hukSaniye):'—'} / ${sure?.muhSaniye!=null?sureyiMetneDonustur(sure.muhSaniye):'—'}${sure?.kaynak==='otomatik'?'<div style="font-size:10px;color:#7dd3fc">Ortak sayaçlardan</div>':''}</td><td style="font-size:11px">${htmlEscape(r.durumText)}</td><td class="live-actions" style="min-width:145px">${actions}</td></tr>`;
        });
        div.innerHTML=html+(bulunan.length?'':'<tr><td colspan="7">'+
            (yoneticiMacGorunumu==='arsiv'?'Henüz arşivlenmiş maç bulunmuyor.':'Aktif maç bulunmuyor.')+
            '</td></tr>')+'</table>';
        const archiveCount=arsivdekiler.length,activeCount=aktifler.length;
        const viewConfig=[
            ['aktif','liveViewAktif',`Aktif Maçlar (${activeCount})`],
            ['arsiv','liveViewArsiv',`Arşiv (${archiveCount})`]
        ];
        for(const [view,id,label] of viewConfig){
            const b=document.getElementById(id);
            if(b){b.textContent=label;b.style.background=yoneticiMacGorunumu===view?'#0f766e':'#475569';b.style.opacity=yoneticiMacGorunumu===view?'1':'0.88';}
        }
    }

    async function yoneticiEksikJuriTaslaklariniKurtar(kategori,macId){
      if(!adminYetkiliMi()||!navigator.onLine||!firebaseBagli)return alert('Bulut taslaklarını kontrol etmek için çevrimiçi yönetici girişi gerekir.');
      const lock='taslak-kurtarma|'+kategori+'|'+macId;
      if(aktifSonucIslemleri.has(lock))return;
      aktifSonucIslemleri.add(lock);
      try{
        const mac=await yoneticiMaciniHazirla(kategori,macId);
        if(!mac||!mac.hukOkul||!mac.muhOkul)throw new Error('Maçın iki okul bilgisi doğrulanamadı.');
        const res=await Promise.all([
          db.ref('okullar/'+kategori).once('value'),
          db.ref('puanlar/'+kategori).once('value')
        ]);
        const okullar=puanlamaRosteriGetir(res[0]);
        const mevcut={};
        res[1].forEach(function(c){
          const v=c.val();
          if(v&&v.secim&&v.puanlar)mevcut[puanKayitKimligi(v.secim,kayitMacId(v))]=v;
        });
        const taraflar=[
          {taraf:'huk',label:'HÜKÜMET',okul:mac.hukOkul},
          {taraf:'muh',label:'MUHALEFET',okul:mac.muhOkul}
        ];
        const roller=['1. Jüri','2. Jüri','3. Jüri'];
        const adaylar=[],kismi=[];
        for(const taraf of taraflar){
          const kaynak=guvenliKadroKaynagiBul(okullar,mac,taraf.taraf,[]);
          if(!kaynak||!okullar[kaynak]||!okullar[kaynak].length)
            throw new Error(taraf.okul+' için öğrenci listesi tekil ve güvenli biçimde eşleştirilemedi.');
          const ogrenciler=okullar[kaynak];
          for(let i=0;i<ogrenciler.length;i++){
            const ad=String(ogrenciler[i]||'').trim();
            if(!ad)continue;
            const konusmaci=i<3?(i+1)+'. Konuşmacı':'Grup Sözcüsü';
            const ogrEtiketi=ad+' ('+konusmaci+')';
            for(const juri of roller){
              const secim={
                kategori:kategori,macId:macId,hukOkul:mac.hukOkul,muhOkul:mac.muhOkul,
                juri:juri,okul:taraf.okul,ogr:ogrEtiketi,taraf:taraf.label
              };
              const kayitId=puanKayitKimligi(secim,macId);
              if(mevcut[kayitId])continue;
              const taslakRef=db.ref('puanTaslaklari/'+kategori+'/'+macId+'/'+kayitId);
              const taslakSnap=await taslakRef.once('value');
              const taslak=taslakSnap.val();
              if(!taslak||!taslak.puanlar)continue;
              const ks=taslak.secim||{};
              const dogruKimlik=
                String(taslak.macId||'')===String(macId)&&
                String(ks.kategori||'')===String(kategori)&&
                String(ks.juri||'')===juri&&
                skorEslesmeAnahtari(ks.okul)===skorEslesmeAnahtari(taraf.okul)&&
                skorEslesmeAnahtari(ks.ogr)===skorEslesmeAnahtari(ogrEtiketi)&&
                String(ks.taraf||'')===taraf.label&&
                skorEslesmeAnahtari(ks.hukOkul)===skorEslesmeAnahtari(mac.hukOkul)&&
                skorEslesmeAnahtari(ks.muhOkul)===skorEslesmeAnahtari(mac.muhOkul)&&
                !!ks.juriAd;
              const puanlarTam=krit.every(function(k,index){
                const p=Number(taslak.puanlar[index]!==undefined?taslak.puanlar[index]:taslak.puanlar[String(index)]);
                return Number.isInteger(p)&&p>=1&&p<=k.m;
              });
              if(!dogruKimlik){kismi.push(ad+' · '+juri+' (kimlik eşleşmedi)');continue;}
              if(!puanlarTam){kismi.push(ad+' · '+juri+' ('+Object.keys(taslak.puanlar||{}).length+'/13)');continue;}
              adaylar.push({kayitId,taslakRef,taslak,secim:ks,ogr:ad,juri,taraf:taraf.label});
            }
          }
        }
        if(!adaylar.length){
          const mesaj=kismi.length
            ?'Tam 13/13 kriterli ve kimliği doğrulanmış bulut taslağı bulunamadı. '+kismi.length+' kısmi/uyuşmayan taslak bulundu; bunlar resmî puanlara aktarılmadı.'
            :'Eksik kayıtlar için Firebase’de bulut taslağı bulunamadı. Hiçbir puan eklenmedi.';
          return alert(mesaj+' Mevcut maç sonucu ve kazanan değiştirilmedi.');
        }
        const liste=adaylar.map(function(x){return '• '+x.juri+' · '+x.ogr+' · '+x.taraf;}).join('\n');
        const onay=confirm(
          'TAMAMLANMIŞ BULUT TASLAKLARINI KURTAR\n\n'+
          adaylar.length+' adet 13/13 kriterli taslak bulundu:\n'+liste+'\n\n'+
          'Yalnızca resmî puan kaydı olmayan anahtarlar oluşturulacak. Mevcut puanlar üzerine yazılmayacak. '+
          'Maçın kapalı/açık durumu, kesinleşmiş sonucu ve kazanan alanına dokunulmayacak.\n\nAktarılsın mı?'
        );
        if(!onay)return;
        let restored=0,already=0,failed=0;
        for(const item of adaylar){
          const officialRef=db.ref('puanlar/'+kategori+'/'+item.kayitId);
          try{
            const recovered={
              ...item.taslak,
              secim:{...item.secim},
              macId:macId,
              mac:macEskiEtiketi(mac.hukOkul,mac.muhOkul),
              macEtiketi:mac.etiket||macEtiketi(mac.hukOkul,mac.muhOkul),
              queuedOffline:false,
              recoveredFromCloudDraft:true,
              recoveredBy:'yonetici',
              recoveredAt:firebase.database.ServerValue.TIMESTAMP,
              updatedAt:firebase.database.ServerValue.TIMESTAMP,
              recoveryNote:'Tam 13/13 Firebase puan taslağından; mevcut maç sonucu değiştirilmeden geri yüklendi.'
            };
            const tx=await officialRef.transaction(function(cur){return cur?cur:recovered;},undefined,false);
            const live=tx.snapshot?tx.snapshot.val():null;
            if(!tx.committed||!firebasePuanKaydiEslesiyor(live,recovered)){
              if(live)already++;else failed++;
              continue;
            }
            restored++;
            const auditRef=db.ref('arsiv/juriPuanKurtarma/'+kategori+'/'+macId+'/'+item.kayitId);
            await auditRef.set({
              islem:'tamamlanmis_bulut_taslagindan_puan_kurtarma',
              kategori: kategori,macId:macId,kayitId:item.kayitId,
              juri:item.juri,ogr:item.ogr,taraf:item.taraf,
              taslak:item.taslak,geriYuklenen:recovered,
              mevcutMacSonucuKorundu:true,
              createdAt:firebase.database.ServerValue.TIMESTAMP
            }).catch(function(e){console.warn('Puan kurtarma denetim kaydı yazılamadı:',e);});
            await item.taslakRef.transaction(function(cur){
              if(!cur)return cur;
              return {...cur,durum:'gonderildi',tamamlandiAt:Date.now(),
                yoneticiTarafindanKurtarildi:true,geriYuklenenKayitId:item.kayitId};
            },undefined,false).catch(function(e){console.warn('Kurtarılan taslak kapatılamadı:',e);});
          }catch(err){
            console.error('Taslak kurtarma kaydı başarısız:',item.kayitId,err);
            failed++;
          }
        }
        alert(
          'Kurtarma tamamlandı.\n\n'+
          'Firebase’e eklenen tam puan kaydı: '+restored+'\n'+
          'İşlem sırasında zaten var olduğu görülen: '+already+'\n'+
          'Aktarılamayan: '+failed+'\n\n'+
          'Mevcut maç sonucu ve kazanan alanı değiştirilmedi.'
        );
        if(document.getElementById('liveMatches'))renderYoneticiCanliPanel();
      }catch(err){
        alert('Bulut taslağı taraması/kurtarma yapılamadı: '+(err&&err.message||err));
      }finally{aktifSonucIslemleri.delete(lock);}
    }

    async function macHukmenKapat(kategori,macId){
        if(!adminYetkiliMi())return alert('Yönetici yetkisi gerekiyor.');
        if(!navigator.onLine||!firebaseBagli)return alert('Hükmen sonuç çevrimiçi kaydedilmelidir.');
        const lock=kategori+'|'+macId;
        if(aktifSonucIslemleri.has(lock))return;
        aktifSonucIslemleri.add(lock);
        try{
            const m=await yoneticiMaciniHazirla(kategori,macId);
            if(m.durum!=='acik')throw new Error('Yalnız açık maçlar hükmen kapatılabilir.');
            if([m.hukOkul,m.muhOkul].some(x=>!x||['boş','bay'].includes(fiksturIstisnaNorm(x))))
                throw new Error('Hükmen kapatma için iki okulun da belirlenmiş olması gerekir.');
            const absent=prompt(`GELMEYEN okul hangisi?\n1 — ${m.hukOkul} (Hükümet)\n2 — ${m.muhOkul} (Muhalefet)\n\n1 veya 2 yazın:`);
            if(absent===null)return;
            if(!['1','2'].includes(absent.trim()))throw new Error('Gelmediği doğrulanan taraf 1 veya 2 olarak seçilmelidir.');
            const maglup=absent.trim()==='1'?m.hukOkul:m.muhOkul;
            const kazanan=absent.trim()==='1'?m.muhOkul:m.hukOkul;
            const gerekce=puanMetniNormalize(prompt(`Hükmen kapatma gerekçesi (${maglup}):`,'Karşı okul maça katılmadı')||'');
            if(!gerekce)return;
            const fixture=await fiksturEslesmesiniBul(kategori,m.hukOkul,m.muhOkul);
            const fSnap=await db.ref('fikstur/tekSalon_2026_2027').once('value');
            const f=fSnap.val()||{};
            const onceki=f.winners?.[fixture.no];
            if(onceki&&skorEslesmeAnahtari(onceki)!==skorEslesmeAnahtari(kazanan))throw new Error('Fikstürde ters yönde seçilmiş bir galip var. Önce o seçimi kaldırın.');
            if(!confirm(`HÜKMEN SONUÇ ONAYI\n\nGelmeyen: ${maglup}\nGalip: ${kazanan}\nGerekçe: ${gerekce}\n\nJüri puanları şartı ARANMAYACAK. Fikstürde galip üst tura aktarılacak. Onaylıyor musunuz?`))return;
            const sonuc={kazanan,maglup,yontem:'hukmen',gerekce,puanHuk:null,puanMuh:null,sureHuk:m.sureEsitlik?.hukSaniye??null,sureMuh:m.sureEsitlik?.muhSaniye??null,macNo:fixture.no,kategori,macId,createdAt:Date.now(),senkronDurum:'bekliyor'};
            const r=await db.ref(`maclar/${kategori}/${macId}`).transaction(cur=>{
                if(!cur||cur.durum!=='acik'||cur.updatedAt!==m.updatedAt)return;
                cur.durum='kapali';cur.closedAt=Date.now();cur.updatedAt=Date.now();cur.version=(cur.version||0)+1;cur.sonuc=sonuc;
                return cur;
            },undefined,false);
            if(!r.committed)throw new Error('Maç başka bir cihazda değişmiş. Güncel durumu kontrol edin.');
            try{await macSonucunuIkiAgacaYansit(kategori,macId,r.snapshot.val(),sonuc,fixture);alert('Maç hükmen kapatıldı ve galip fikstüre işlendi.');}
            catch(err){alert('Hükmen maç KAPATILDI, ancak fikstür senkronu eksik: '+(err?.message||err)+'\nSenkronu Onar düğmesini kullanın.');}
        }catch(err){alert('Hükmen kapatma yapılamadı: '+(err?.message||err));}
        finally{aktifSonucIslemleri.delete(lock);}
    }

    // İki taraf da katılmazsa hiçbir okul üst tura çıkarılmaz. Bu işlem BAY değildir.
    async function macCiftElemeIleKapat(kategori,macId){
      if(!adminYetkiliMi())return alert('Yönetici yetkisi gerekiyor.');
      if(!navigator.onLine||!firebaseBagli)return alert('Çift eleme kararı için Firebase bağlantısı gerekli.');
      const lock=kategori+'|'+macId;
      if(aktifSonucIslemleri.has(lock))return;
      aktifSonucIslemleri.add(lock);
      try{
        const m=await yoneticiMaciniHazirla(kategori,macId);
        if(m.durum!=='acik')throw new Error('Yalnız açık maçlar çift eleme kararıyla kapatılabilir.');
        if([m.hukOkul,m.muhOkul].some(x=>!x||['boş','bay'].includes(fiksturIstisnaNorm(x))))
          throw new Error('İki okul da belli olmalı. Rakip bekleyen maç çift eleme ile kapatılamaz.');
        const fixture=await fiksturEslesmesiniBul(kategori,m.hukOkul,m.muhOkul);
        const f=(await db.ref(FIKSTUR_ISTISNA_YOLU).once('value')).val()||{};
        if(f.winners?.[fixture.no]||f.finalizedMatches?.[fixture.no])throw new Error('Fikstürde bu maçın galibi veya kesinleşmiş sonucu var. Önce bu kaydı kontrol edin.');
        const pts=await db.ref('puanlar/'+kategori).once('value');
        const count=Object.keys(yoneticiMacaAitHamPuanlar(pts,macId)).length;
        if(count)throw new Error('Bu maç için jüri puanları mevcut. Önce arşivli puan temizliğiyle kayıtları inceleyin.');
        const gerekce=puanMetniNormalize(prompt(`İKİ OKUL DA KATILMADI\n\n${m.hukOkul}\n${m.muhOkul}\n\nKarar gerekçesini girin:`,'Her iki okulun da maça katılmaması nedeniyle çift eleme kararı')||'');
        if(!gerekce)return;
        if(gerekce.length<12)throw new Error('Gerekçe en az 12 karakter olmalıdır.');
        if(prompt(`ÇİFT ELEME ONAYI\n\n#${fixture.no}\n${m.hukOkul}\n${m.muhOkul}\n\nHer iki okul ELENECEK, GALİP OLMAYACAK.\nÜst tur gerekirse yeniden planlanacaktır.\n\nOnaylamak için CIFT ELEME yazın:`)!=='CIFT ELEME')return;
        const sonuc={kazanan:null,maglup:null,yontem:'cift_eleme',gerekce,elenenOkullar:[m.hukOkul,m.muhOkul],
          puanHuk:null,puanMuh:null,macNo:fixture.no,kategori,macId,createdAt:Date.now(),senkronDurum:'bekliyor'};
        await db.ref(`arsiv/yoneticiKararlari/${kategori}/${Date.now()}_${macId}`).set({
          kategori,macId,oncekiMac:m,sonuc,createdAt:firebase.database.ServerValue.TIMESTAMP});
        const r=await db.ref(`maclar/${kategori}/${macId}`).transaction(cur=>{
          if(!cur||cur.durum!=='acik'||cur.updatedAt!==m.updatedAt)return;
          cur.durum='kapali';cur.closedAt=Date.now();cur.updatedAt=Date.now();cur.version=(cur.version||0)+1;cur.sonuc=sonuc;
          return cur;
        },undefined,false);
        if(!r.committed)throw new Error('Maç başka cihazda değişti. Güncel durumu kontrol edin.');
        try{
          await macSonucunuIkiAgacaYansit(kategori,macId,r.snapshot.val(),sonuc,fixture);
          alert('ÇİFT ELEME kaydedildi. İki okul elendi, galip oluşturulmadı. Üst turu ayrıca düzenleyin.');
        }catch(err){alert('İki okul ELENDİ; ancak fikstür senkronu eksik: '+(err?.message||err)+'\nSenkronu Onar kullanın.');}
      }catch(err){alert('Çift eleme uygulanamadı: '+(err?.message||err));}
      finally{aktifSonucIslemleri.delete(lock);}
    }

    async function macIptaliniDegistir(kategori,macId,iptalEt){
        if(!adminYetkiliMi())return alert('Yönetici yetkisi gerekiyor.');
        if(!navigator.onLine||!firebaseBagli)return alert('İptal işlemi için bağlantı gerekiyor.');
        const lock=kategori+'|'+macId;
        if(aktifSonucIslemleri.has(lock))return;
        aktifSonucIslemleri.add(lock);
        try{
            const m=await yoneticiMaciniHazirla(kategori,macId);
            if(iptalEt){
                if(m.durum!=='acik')throw new Error('Yalnız açık maç iptal edilebilir.');
                const p=await db.ref('puanlar/'+kategori).once('value');
                if(snapshotKayitlariniTekillestir(p).some(x=>kayitMacId(x)===macId))throw new Error('Bu maça puan girilmiş. Puanlı maç iptal edilemez; sonuçların önce incelenmesi gerekir.');
            } else if(m.durum!=='iptal')throw new Error('Bu maç iptal edilmemiş.');
            if(!confirm(iptalEt?'Maçı iptal edip jüri seçiminden kaldırmak istiyor musunuz? Resmî fikstür ve veriler silinmez.':'Maç iptalini kaldırıp yeniden puanlamaya açmak istiyor musunuz?'))return;
            const r=await db.ref(`maclar/${kategori}/${macId}`).transaction(cur=>{
                if(!cur||cur.updatedAt!==m.updatedAt||cur.durum!==(iptalEt?'acik':'iptal'))return;
                cur.durum=iptalEt?'iptal':'acik';cur.iptal=iptalEt?{tarih:Date.now(),aciklama:'Yönetici tarafından iptal edildi'}:null;cur.updatedAt=Date.now();
                return cur;
            },undefined,false);
            if(!r.committed)throw new Error('Maç başka cihazda değiştirildi.');
            alert(iptalEt?'Maç iptal edildi. Fikstür ve geçmiş kayıtlar korundu.':'Maç yeniden açıldı.');
        }catch(err){alert('Maç iptali işlenemedi: '+(err?.message||err));}
        finally{aktifSonucIslemleri.delete(lock);}
    }

    // Sadece bu maçın puanlarını hedefler. Veriyi önce arşive yazar; CAS transaction
    // esnasında yeni puan / başka cihaz değişikliği görülürse temizleme iptal edilir.
    function yoneticiMacaAitHamPuanlar(snapshot,macId){
        const rows={};
        snapshot.forEach(c=>{
            const v=c.val();
            if(v?.secim && v?.puanlar && kayitMacId(v)===macId)rows[c.key]=v;
        });
        return rows;
    }

    async function yoneticiMacPuanlariniArsivleVeTemizle(kategori,macId,aciklama,ekMac=null){
        const pRef=db.ref('puanlar/'+kategori);
        const ilk=await pRef.once('value');
        const hedefler=yoneticiMacaAitHamPuanlar(ilk,macId);
        const keys=Object.keys(hedefler);
        if(!keys.length)return {sayi:0,arsivYolu:''};
        const arKey=Date.now()+'_'+macId+'_'+hash32(keys.join('|')+'|'+Math.random());
        const arsivYolu=`arsiv/yoneticiPuanTemizligi/${kategori}/${arKey}`;
        await db.ref(arsivYolu).set({kategori,macId,aciklama,createdAt:firebase.database.ServerValue.TIMESTAMP,
            mac:ekMac||null,puanKayitSayisi:keys.length,puanlar:hedefler});
        const before=JSON.stringify(hedefler);
        const trans=await pRef.transaction(cur=>{
            const curRows={};
            for(const [key,value] of Object.entries(cur||{})){
                if(value?.secim && value?.puanlar && kayitMacId(value)===macId)curRows[key]=value;
            }
            if(JSON.stringify(curRows)!==before)return;
            const out={...(cur||{})};
            for(const key of keys)delete out[key];
            return Object.keys(out).length?out:null;
        },undefined,false);
        if(!trans.committed)throw new Error('Puanlar başka cihazdan değişti. Silme yapılmadı; arşiv korundu. Verileri yenileyip tekrar deneyin.');
        // Bu cihazdaki henüz gönderilmemiş aynı maça ait puanlar merkezi veriyi geri doldurmasın.
        const q=offlineKuyrukGetir();let changed=false;
        for(const [key,item] of Object.entries(q)){
            if(item.kategori===kategori && item.macId===macId){delete q[key];changed=true;}
        }
        if(changed)offlineKuyrukKaydet(q);
        return {sayi:keys.length,arsivYolu};
    }

    async function yoneticiMacPuanlariniTemizle(kategori,macId){
        if(!adminYetkiliMi())return alert('Yönetici yetkisi gerekiyor.');
        if(!navigator.onLine||!firebaseBagli)return alert('Temizlik için Firebase bağlantısı gerekiyor.');
        const lock=kategori+'|'+macId;
        if(aktifSonucIslemleri.has(lock))return;
        aktifSonucIslemleri.add(lock);
        try{
            const ref=db.ref(`maclar/${kategori}/${macId}`),m=(await ref.once('value')).val()||yoneticiFiksturMaclari.find(x=>x.id===macId);
            if(!m)throw new Error('Maç fikstürden bulunamadı.');
            if(m.durum==='kapali'||m.durum==='iptal')throw new Error('Kesinleşmiş veya iptal edilmiş maçın puanları bu işlemle temizlenmez. Önce maçı yeniden açın.');
            const p=await db.ref('puanlar/'+kategori).once('value');
            const rows=yoneticiMacaAitHamPuanlar(p,macId),sayi=Object.keys(rows).length;
            if(!sayi)return alert('Seçilen maçta temizlenecek puan bulunamadı.');
            const onay=prompt(`${m.etiket||macEtiketi(m.hukOkul,m.muhOkul)}\n\n${sayi} PUAN KAYDI ARŞİVLENECEK VE AKTİF SONUÇLARDAN KALDIRILACAK.\nOkullar, öğrenciler, sabit fikstür ve diğer maçlar değişmez.\n\nOnay için TEMİZLE yazın:`);
            if(onay!=='TEMİZLE')return;
            const result=await yoneticiMacPuanlariniArsivleVeTemizle(kategori,macId,'yonetici_deneme_puani_temizligi',m);
            alert(`${result.sayi} puan kaydı arşivlenerek temizlendi. Fikstür ve kayıtlı öğrenciler korundu. Başka jüri cihazlarında çevrimdışı bekleyen kayıt varsa ayrıca temizlenmelidir.`);
        }catch(err){alert('Puan temizliği yapılamadı: '+(err?.message||err));}
        finally{aktifSonucIslemleri.delete(lock);}
    }

    // Hatalı öğrenci listesine rağmen özel sonuç; olağan 3/3 jüri hesabına alternatif değildir.
    // Kazanan/yasal gerekçe açıkça yönetici tarafından seçilir ve iki ağaçla senkronlanır.
    async function yoneticiKarariylaKapat(kategori,macId){
        if(!adminYetkiliMi())return alert('Yönetici yetkisi gerekiyor.');
        if(!navigator.onLine||!firebaseBagli)return alert('Yönetici kararı yalnız çevrimiçi kaydedilebilir.');
        const lock=kategori+'|'+macId;
        if(aktifSonucIslemleri.has(lock))return;
        aktifSonucIslemleri.add(lock);
        try{
            const m=await yoneticiMaciniHazirla(kategori,macId);
            if(m.durum!=='acik')throw new Error('Yalnız açık maçlar özel kararla kapatılabilir.');
            const secim=prompt(`İSTİSNAİ YÖNETİCİ KARARI\n\nKazanan okulu seçin:\n1 — ${m.hukOkul}\n2 — ${m.muhOkul}\n\n1 veya 2 girin:`);
            if(secim===null)return;
            if(!['1','2'].includes(secim.trim()))throw new Error('Kazanan 1 veya 2 ile seçilmeli.');
            const kazanan=secim.trim()==='1'?m.hukOkul:m.muhOkul;
            const maglup=secim.trim()==='1'?m.muhOkul:m.hukOkul;
            const gerekce=puanMetniNormalize(prompt('3/3 jüri veya öğrenci kaydı kontrolü neden atlanıyor? Gerekçeyi ayrıntılı yazın:','Öğrenci listesi ve deneme puanlarının uyuşmaması nedeniyle yönetici kararı')||'');
            if(!gerekce)return;
            if(gerekce.length<12)throw new Error('Denetlenebilir gerekçe en az 12 karakter olmalıdır.');
            const fixture=await fiksturEslesmesiniBul(kategori,m.hukOkul,m.muhOkul);
            const mevcutFikstur=(await db.ref('fikstur/tekSalon_2026_2027').once('value')).val()||{};
            const eski=mevcutFikstur.winners?.[fixture.no];
            if(eski && skorEslesmeAnahtari(eski)!==skorEslesmeAnahtari(kazanan))throw new Error('Fikstürde farklı galip kaydedilmiş. Önce resmi fikstür sonucunu kontrol edin.');
            const p=await db.ref('puanlar/'+kategori).once('value');
            const puanSayisi=Object.keys(yoneticiMacaAitHamPuanlar(p,macId)).length;
            const yes=prompt(`YÖNETİCİ KARARI İLE KAPAT\n\n${m.hukOkul} — ${m.muhOkul}\nGalip: ${kazanan}\nGerekçe: ${gerekce}\nBu maçta ${puanSayisi} puan kaydı var; kayıtlar SİLİNMEYECEK.\n\n3/3 jüri ve öğrenci eşleşmesi kontrolü YALNIZ BU MAÇTA atlanacak.\nGalip sonraki tura aktarılacak.\n\nOnay için KARAR yazın:`);
            if(yes!=='KARAR')return;
            const sonuc={kazanan,maglup,yontem:'yonetici_karari',gerekce,puanHuk:null,puanMuh:null,
                sureHuk:m.sureEsitlik?.hukSaniye??null,sureMuh:m.sureEsitlik?.muhSaniye??null,
                macNo:fixture.no,kategori,macId,createdAt:Date.now(),senkronDurum:'bekliyor',
                yoneticiIstisnasi:true,puanKayitSayisi:puanSayisi};
            const auditRef=db.ref(`arsiv/yoneticiKararlari/${kategori}/${Date.now()}_${macId}`);
            await auditRef.set({kategori,macId,mac:{...m},sonuc,createdAt:firebase.database.ServerValue.TIMESTAMP});
            const r=await db.ref(`maclar/${kategori}/${macId}`).transaction(cur=>{
                if(!cur||cur.durum!=='acik'||cur.updatedAt!==m.updatedAt)return;
                cur.durum='kapali';cur.closedAt=Date.now();cur.updatedAt=Date.now();cur.version=(cur.version||0)+1;cur.sonuc=sonuc;
                return cur;
            },undefined,false);
            if(!r.committed)throw new Error('Maç başka cihazda değişti. Karar kaydedilmedi; yeniden kontrol edin.');
            try{await macSonucunuIkiAgacaYansit(kategori,macId,r.snapshot.val(),sonuc,fixture);
                alert('Yönetici kararıyla maç kesinleştirildi. Gerekçe arşive, galip sonraki tura işlendi.');}
            catch(err){alert('Yönetici kararıyla maç KAPATILDI ancak fikstür eşitleme tamamlanamadı: '+(err?.message||err)+'\nSenkronu Onar seçeneğini kullanın.');}
        }catch(err){alert('Yönetici kararı uygulanamadı: '+(err?.message||err));}
        finally{aktifSonucIslemleri.delete(lock);}
    }

    async function yoneticiMacKaydiniSil(kategori,macId){
        if(!adminYetkiliMi())return alert('Yönetici yetkisi gerekiyor.');
        if(!navigator.onLine||!firebaseBagli)return alert('Silme için çevrimiçi bağlantı gereklidir.');
        const lock=kategori+'|'+macId;
        if(aktifSonucIslemleri.has(lock))return;
        aktifSonucIslemleri.add(lock);
        try{
            const ref=db.ref(`maclar/${kategori}/${macId}`),ss=await ref.once('value'),m=ss.val();
            if(!m)throw new Error('Silinecek maç kaydı bulunamadı.');
            if(m.durum!=='acik'||m.sonuc?.kazanan)throw new Error('Sonuçlandırılmış veya iptal edilmiş maç silinemez. Önce durumu düzeltin.');
            const p=await db.ref('puanlar/'+kategori).once('value');
            const sayi=Object.keys(yoneticiMacaAitHamPuanlar(p,macId)).length;
            const text=`${m.hukOkul} — ${m.muhOkul}\n\nMaç operasyon kaydı silinecek. ${sayi} puan kaydı${sayi?' ÖNCE ARŞİVLENEREK AKTİF PUANLARDAN KALDIRILACAK':''}.\nResmî fikstür, öğrenci listeleri ve diğer maçlar korunacak; fikstürdeki maç yeniden listelenebilir.\n\nOnaylamak için MAC SIL yazın:`;
            if(prompt(text)!=='MAC SIL')return;
            const arKey=Date.now()+'_'+macId;
            await db.ref(`arsiv/silinenMacKayitlari/${kategori}/${arKey}`).set({mac:m,deletedAt:firebase.database.ServerValue.TIMESTAMP,reason:'yonetici_mac_kaydi_sil',puanKaydi:sayi});
            let scoreResult={sayi:0};
            if(sayi)scoreResult=await yoneticiMacPuanlariniArsivleVeTemizle(kategori,macId,'mac_kaydi_silme_oncesi',m);
            const r=await ref.transaction(cur=>{
                if(!cur||cur.updatedAt!==m.updatedAt||cur.durum!=='acik'||cur.sonuc?.kazanan)return;
                return null;
            },undefined,false);
            if(!r.committed)throw new Error('Maç kaydı başka cihazda değişti; silinemedi. Puan arşivini ve durumu kontrol edin.');
            alert(`Maç operasyon kaydı silindi. ${scoreResult.sayi} puan kaydı arşivlendi. Resmî fikstür ve okul/öğrenci kayıtları KORUNDU.`);
        }catch(err){alert('Maç kaydı silinemedi: '+(err?.message||err));}
        finally{aktifSonucIslemleri.delete(lock);}
    }

    // Yönetici paneli başka bilgisayarda açıkken de takımların dinamik olarak
    // çözümlenebilmesi için fikstürün aynı-origin iframe hesaplayıcısını kullanır.
    let gizliFiksturFrame=null;
    let sonFiksturMacListesi=[];
    async function fiksturEslesmesiniBul(kategori,hukOkul,muhOkul) {
        const tumFrame=document.getElementById('turnuvaFiksturFrame');
        let frame=tumFrame || gizliFiksturFrame;
        if(!frame) {
            frame=document.createElement('iframe');
            frame.id='fiksturGizliEslesme';
            frame.title='Fikstür eşleşme doğrulaması';
            frame.style.cssText='display:none;';
            document.body.appendChild(frame);
            gizliFiksturFrame=frame;
            frame.srcdoc=base64Utf8Coz(TURNUVA_FIKSTUR_B64);
        }
        let liste=null;
        for(let i=0;i<80;i++) {
            try { liste=frame.contentWindow?.fiksturTumMaclariGetir?.(); } catch(_) {}
            if(liste) break;
            await new Promise(resolve=>setTimeout(resolve,150));
        }
        if(!liste) throw new Error('Firebase fikstürü henüz açılamadı. Turnuva Ağacı ekranını bir kez açıp internet bağlantısını kontrol edin.');
        sonFiksturMacListesi=liste;
        const cat=kategori==='LİSE'?'lise':'ortaokul';
        const found=liste.filter(m=>!m.isBay && m.cat===cat && okulCiftiEslesiyor(m.team1,m.team2,hukOkul,muhOkul));
        if(found.length!==1) throw new Error(found.length?'Fikstürde bu iki okulun birden çok eşleşmesi var. Otomatik sonuç güvenli şekilde eşlenemedi.':'Fikstürde bu iki okulun geçerli eşleşmesi bulunamadı. Okul adlarının fikstürdekiyle aynı olduğundan ve önceki tur galiplerinin seçildiğinden emin olun.');
        return found[0];
    }

    async function macSonucunuHesapla(kategori,macId,m,fixture) {
        const [pSnap,oSnap,fSnap]=await Promise.all([
            db.ref('puanlar/'+kategori).once('value'),
            db.ref('okullar/'+kategori).once('value'),
            db.ref('fikstur/tekSalon_2026_2027').once('value')
        ]);
        const okullar={};oSnap.forEach(c=>{okullar[c.key]=[];c.forEach(x=>okullar[c.key].push(String(x.val())));});
        const data=macTamamlamaOzeti(snapshotKayitlariniTekillestir(pSnap),macId,m,okullar);
        if(!data.ready) throw new Error(`3/3 jüri ve öğrenci listesi tamamlanmadan maç kapatılamaz.\n${data.sorunlar.slice(0,6).join('\n')}${data.sorunlar.length>6?'\n...':''}`);
        const huk=Number(data.toplamlar[m.hukOkul]||0),muh=Number(data.toplamlar[m.muhOkul]||0);
        let kazanan='',yontem='puan';
        if(huk>muh)kazanan=m.hukOkul;
        else if(muh>huk)kazanan=m.muhOkul;
        else {
            const s=m.sureEsitlik||{};
            if(skorEslesmeAnahtari(s.hukOkul)!==skorEslesmeAnahtari(m.hukOkul) || skorEslesmeAnahtari(s.muhOkul)!==skorEslesmeAnahtari(m.muhOkul) || !Number.isInteger(s.hukSaniye) || !Number.isInteger(s.muhSaniye) || s.hukSaniye<=0 || s.muhSaniye<=0)
                throw new Error('Jüri puanları eşit. Önce iki takımın toplam konuşma süresini ⏱ Süreler modülünden Firebase’e kaydedin.');
            if(s.hukSaniye<s.muhSaniye){kazanan=m.hukOkul;yontem='sure';}
            else if(s.muhSaniye<s.hukSaniye){kazanan=m.muhOkul;yontem='sure';}
            else {
                const f=fSnap.val();
                const manuel=f?.winnerSources?.[fixture.no];
                const manuelGalip=f?.winners?.[fixture.no];
                if(manuel?.source!=='manuel' || ![m.hukOkul,m.muhOkul].some(n=>skorEslesmeAnahtari(n)===skorEslesmeAnahtari(manuelGalip)))
                    throw new Error('Hem puan hem konuşma süreleri eşit. Son savunmanın ardından Turnuva Ağacı → Fikstür Yönetimi ekranında bu maçın galibini manuel seçin; ardından Maçı Kapat işlemini tekrarlayın.');
                kazanan=[m.hukOkul,m.muhOkul].find(n=>skorEslesmeAnahtari(n)===skorEslesmeAnahtari(manuelGalip));
                yontem='son_savunma';
            }
        }
        const oncekiSecim=fSnap.val()?.winners?.[fixture.no];
        if (oncekiSecim && skorEslesmeAnahtari(oncekiSecim)!==skorEslesmeAnahtari(kazanan))
            throw new Error('Fikstürde daha önce ters yönde manuel galip seçilmiş. Önce Turnuva Ağacı ekranından bu seçimi temizleyin; yanlış galip otomatik ezilmeyecek.');
        return {kazanan,yontem,puanHuk:huk,puanMuh:muh,maglup:kazanan===m.hukOkul?m.muhOkul:m.hukOkul,sureHuk:m.sureEsitlik?.hukSaniye ?? null,sureMuh:m.sureEsitlik?.muhSaniye ?? null,macNo:fixture.no,kategori,macId,createdAt:Date.now(),senkronDurum:'bekliyor'};
    }

    async function fiksturSonucunuEsitle(kategori,macId,m,sonuc,fixture) {
        const ref=db.ref('fikstur/tekSalon_2026_2027');
        const applied=await ref.transaction(cur=>{
            if(!cur || !cur.juries || !cur.topics) return;
            const onceki=cur.finalizedMatches?.[fixture.no];
            if(onceki && onceki.macId!==macId) return;
            if(cur.noWinnerMatches?.[fixture.no])return;
            const resmiKazanan=yoneticiFiksturKazanan(m,sonuc,fixture);
            const secili=cur.winners?.[fixture.no] || null;
            if (secili && skorEslesmeAnahtari(secili)!==skorEslesmeAnahtari(resmiKazanan)) return;
            if(sonuc.yontem==='son_savunma' && cur.winnerSources?.[fixture.no]?.source!=='manuel' && !onceki) return;
            cur.winners=cur.winners||{};
            cur.winnerSources=cur.winnerSources||{};
            cur.finalizedMatches=cur.finalizedMatches||{};
            cur.winners[fixture.no]=resmiKazanan;
            cur.winnerSources[fixture.no]={source:sonuc.yontem,updatedAt:Date.now(),macId};
            cur.finalizedMatches[fixture.no]={macId,kategori,kazanan:resmiKazanan,yontem:sonuc.yontem,puanHuk:sonuc.puanHuk,puanMuh:sonuc.puanMuh,sureHuk:sonuc.sureHuk,sureMuh:sonuc.sureMuh,gerekce:sonuc.gerekce||null,closedAt:Date.now(),fiksturBaglantisi:sonuc.fiksturBaglantisi||null};
            cur.updatedAt=Date.now();cur.sonIslem='juriSonucuKesinlestir';
            return cur;
        },undefined,false);
        if(!applied.committed) throw new Error('Fikstürde farklı bir galip veya kesinleşmiş sonuç var. Otomatik üzerine yazılmadı; yönetici kontrolü gerekli.');
    }

    async function merkeziAgacaKesinSonucuYaz(kategori,macId,m,sonuc,fixture) {
        const resmiKazanan=yoneticiFiksturKazanan(m,sonuc,fixture);
        const yon=sonuc.fiksturBaglantisi?.yon||yoneticiFiksturTarafiniBul(m,fixture);
        const birinciPuan=yon==='ayni'?sonuc.puanHuk:sonuc.puanMuh;
        const ikinciPuan=yon==='ayni'?sonuc.puanMuh:sonuc.puanHuk;
        let eslesti=false,engel='';
        const r=await turnuvaRef(kategori).transaction(state=>{
            state=state||{};
            state.fiksturSonuclari=state.fiksturSonuclari||{};
            const eski=state.fiksturSonuclari[sonuc.macNo];
            if(eski && eski.macId!==macId){engel='Farklı maç kaydı bu resmî numarayı kullanıyor.';return;}
            state.fiksturSonuclari[sonuc.macNo]={macNo:sonuc.macNo,macId,galip:resmiKazanan,okul1:fixture.team1,okul2:fixture.team2,puan1:birinciPuan,puan2:ikinciPuan,yontem:sonuc.yontem,updatedAt:Date.now()};
            for(const round of Object.values(state.rounds||{})){
                for(const entry of Object.values(round.matches||{})){
                    if(entry.team2==='BYE' || !okulCiftiEslesiyor(entry.team1,entry.team2,fixture.team1,fixture.team2))continue;
                    if(entry.winner && skorEslesmeAnahtari(entry.winner)!==skorEslesmeAnahtari(resmiKazanan)){
                       engel='Merkezî ağaçta başka bir galip var.';return;
                    }
                    eslesti=true;
                    const team1Birinci=skorEslesmeAnahtari(entry.team1)===skorEslesmeAnahtari(fixture.team1);
                    entry.score1=team1Birinci?birinciPuan:ikinciPuan;
                    entry.score2=team1Birinci?ikinciPuan:birinciPuan;
                    entry.provisionalWinner=resmiKazanan;
                    entry.winner=resmiKazanan;
                    entry.sonucYontemi=sonuc.yontem;
                    entry.updatedAt=Date.now();
                }
            }
            state.revision=(state.revision||0)+1;state.updatedAt=Date.now();
            return state;
        },undefined,false);
        if(!r.committed)throw new Error('Merkezî sonuç eşitlenemedi: '+(engel||'Kayıt güncellenemedi.'));
        return eslesti?'eslestirilen_agaca_islendi':'resmi_fikstur_sonuc_listesine_islendi';
    }

    async function macSonucunuIkiAgacaYansit(kategori,macId,m,sonuc,fixture) {
        if(sonuc.yontem==='cift_eleme'){
            const ref=db.ref(FIKSTUR_ISTISNA_YOLU);
            const applied=await ref.transaction(cur=>{
                if(!cur?.juries||!cur?.topics||cur.winners?.[fixture.no])return;
                const onceki=cur.finalizedMatches?.[fixture.no];
                if(onceki && (onceki.macId!==macId||onceki.yontem!=='cift_eleme'))return;
                cur.winners=cur.winners||{};
                cur.winnerSources=cur.winnerSources||{};
                cur.finalizedMatches=cur.finalizedMatches||{};
                cur.noWinnerMatches=cur.noWinnerMatches||{};
                delete cur.winners[fixture.no];
                cur.winnerSources[fixture.no]={source:'cift_eleme',updatedAt:Date.now(),macId};
                cur.finalizedMatches[fixture.no]={macId,kategori,kazanan:null,yontem:'cift_eleme',
                    elenenOkullar:sonuc.elenenOkullar,gerekce:sonuc.gerekce,closedAt:Date.now()};
                cur.noWinnerMatches[fixture.no]={macId,elenenOkullar:sonuc.elenenOkullar,
                    gerekce:sonuc.gerekce,updatedAt:Date.now()};
                cur.updatedAt=Date.now();cur.sonIslem='yoneticiCiftEleme';
                return cur;
            },undefined,false);
            if(!applied.committed)throw new Error('Fikstürde farklı maç sonucu var. Çift eleme eşitlenemedi.');
            await turnuvaRef(kategori).transaction(state=>{
                state=state||{};state.fiksturSonuclari=state.fiksturSonuclari||{};
                state.fiksturSonuclari[fixture.no]={macNo:fixture.no,macId,galip:null,
                    okul1:m.hukOkul,okul2:m.muhOkul,puan1:null,puan2:null,yontem:'cift_eleme',updatedAt:Date.now()};
                for(const round of Object.values(state.rounds||{}))for(const entry of Object.values(round.matches||{})){
                    if(entry.team2!=='BYE'&&okulCiftiEslesiyor(entry.team1,entry.team2,m.hukOkul,m.muhOkul)){
                        entry.score1=null;entry.score2=null;entry.winner='';entry.provisionalWinner='';
                        entry.status='cift_eleme';entry.updatedAt=Date.now();
                    }
                }
                state.revision=(state.revision||0)+1;state.updatedAt=Date.now();return state;
            },undefined,false);
            await db.ref(`maclar/${kategori}/${macId}/sonuc`).update({senkronDurum:'tamam',
                merkeziAgac:'cift_eleme_galipsiz',syncedAt:Date.now()});
            return;
        }
        await fiksturSonucunuEsitle(kategori,macId,m,sonuc,fixture);
        const merkezDurum=await merkeziAgacaKesinSonucuYaz(kategori,macId,m,sonuc,fixture);
        await db.ref(`maclar/${kategori}/${macId}/sonuc`).update({senkronDurum:'tamam',merkeziAgac:merkezDurum,syncedAt:Date.now()});
    }

    const aktifSonucIslemleri=new Set();
    async function macEsitlemeyiTekrarDene(kategori,macId) {
        if(!adminYetkiliMi())return alert('Bu işlem yalnızca yönetici tarafından yapılabilir.');
        const lock=kategori+'|'+macId;
        if(aktifSonucIslemleri.has(lock))return;
        if(!navigator.onLine||!firebaseBagli)return alert('Firebase bağlantısı yok.');
        aktifSonucIslemleri.add(lock);
        try {
            const s=await db.ref(`maclar/${kategori}/${macId}`).once('value');
            const m=s.val();
            if(m?.durum!=='kapali' || (!m.sonuc?.kazanan && m.sonuc?.yontem!=='cift_eleme'))throw new Error('Kesinleştirilmiş maç sonucu bulunamadı.');
            const fixture=await yoneticiFiksturuCoz(kategori,m);
            if(m.sonuc.macNo!=null && fixture.no!==m.sonuc.macNo)throw new Error('Fikstür maç numarası değişmiş. Manuel kontrol gerekli.');
            if(m.sonuc.macNo==null){
                const fixed=await db.ref(`maclar/${kategori}/${macId}/sonuc`).transaction(cur=>{
                    if(!cur || cur.macNo!=null || cur.kazanan!==m.sonuc.kazanan)return;
                    return {...cur,macNo:fixture.no,senkronDurum:'bekliyor'};
                },undefined,false);
                if(!fixed.committed)throw new Error('Sonuç başka cihazda değişti; fikstür eşlemesi tekrar kontrol edilmeli.');
                m.sonuc=fixed.snapshot.val();
            }
            await macSonucunuIkiAgacaYansit(kategori,macId,m,m.sonuc,fixture);
            alert('Sonuç fikstür ve merkezî ağaçla eşitlendi.');
        }catch(err){alert('Senkron onarılamadı: '+(err?.message||err));}
        finally{aktifSonucIslemleri.delete(lock);}
    }

    async function macDurumuDegistir(kategori,macId,yeniDurum) {
        if(!adminYetkiliMi())return alert('Yönetici yetkisi gerekli.');
        if(!navigator.onLine||!firebaseBagli)return alert('Maç sonuçlarını kesinleştirmek için Firebase çevrimiçi olmalıdır.');
        const lock=kategori+'|'+macId;
        if(aktifSonucIslemleri.has(lock))return;
        aktifSonucIslemleri.add(lock);
        try {
            const ref=db.ref(`maclar/${kategori}/${macId}`);
            const m=await yoneticiMaciniHazirla(kategori,macId);
            if(!m?.hukOkul||!m?.muhOkul)throw new Error('Maç için iki okul bulunamadı.');
            if(yeniDurum==='kapali') {
                if(m.durum!=='acik')throw new Error(`Bu maçın kayıtlı durumu "${String(m.durum||'boş')}" görünüyor. Yalnızca gerçekten açık maç kesinleştirilebilir.`);
                await otomatikSureleriKaydet(kategori,macId);
                const kontrol=(await ref.once('value')).val()||m;
                const fixture=await fiksturEslesmesiniBul(kategori,kontrol.hukOkul,kontrol.muhOkul);
                const sonuc=await macSonucunuHesapla(kategori,macId,kontrol,fixture);
                if(!confirm(`${m.hukOkul}: ${sonuc.puanHuk} puan\n${m.muhOkul}: ${sonuc.puanMuh} puan\n\nGALİP: ${sonuc.kazanan}\nYÖNTEM: ${sonuc.yontem==='puan'?'Jüri puanı':sonuc.yontem==='sure'?'Daha kısa toplam konuşma süresi':'Son savunma (manuel)'}\n\nMaçı kapatıp iki turnuva ağacına kaydetmek istiyor musunuz?`))return;
                const trans=await ref.transaction(cur=>{
                    if(!cur || cur.durum!=='acik' || cur.updatedAt!==kontrol.updatedAt || (cur.sureEsitlik?.updatedAt||0)!==(kontrol.sureEsitlik?.updatedAt||0))return;
                    cur.durum='kapali';cur.closedAt=Date.now();cur.updatedAt=Date.now();cur.version=(cur.version||0)+1;
                    cur.sonuc=sonuc;return cur;
                },undefined,false);
                if(!trans.committed)throw new Error('Maç başka cihazda değişti. Güncel puan ve süreleri kontrol ederek tekrar deneyin.');
                try {
                    await macSonucunuIkiAgacaYansit(kategori,macId,trans.snapshot.val(),sonuc,fixture);
                    alert('Maç kapatıldı. Galip, puan/süre kuralına göre iki ağaçla eşitlendi.');
                }catch(err){alert('Maç KAPATILDI fakat ağaç senkronizasyonu tamamlanamadı: '+(err?.message||err)+'\nYönetici Canlı Panelindeki “Senkronu Onar” düğmesini kullanın.');}
            } else if(yeniDurum==='acik') {
                if(m.durum!=='kapali')return;
                // Merkezî kayıt kesinleşmiş fakat hiçbir resmî fikstüre bağlanmamışsa
                // standart fikstür silme işlemi uygulanmadan güvenle yeniden açılabilir.
                if(m.sonuc && m.sonuc.macNo==null && !m.sonuc.fiksturBaglantisi && !m.fiksturBaglantisi){
                    const [fs,ts]=await Promise.all([
                        db.ref('fikstur/tekSalon_2026_2027').once('value'),turnuvaRef(kategori).child('fiksturSonuclari').once('value')]);
                    const hasFixture=Object.values(fs.val()?.finalizedMatches||{}).some(v=>v?.macId===macId) ||
                       Object.values(ts.val()||{}).some(v=>v?.macId===macId);
                    if(hasFixture)throw new Error('Maçın resmî bir kayıt bağlantısı bulundu. Önce fikstürle eşleştirme/denetim yapılmalı.');
                    if(!confirm('Bu sonuç yalnızca merkezî maç kaydında bulunuyor; resmî fikstüre aktarılmamış. Maçı yeniden açıp merkezî sonucu kaldırmak istiyor musunuz? Jüri puanları silinmeyecek.'))return;
                    const tr=await ref.transaction(cur=>{
                        if(!cur||cur.durum!=='kapali'||cur.updatedAt!==m.updatedAt||cur.sonuc?.macId!==macId||cur.sonuc?.macNo!=null)return;
                        cur.durum='acik';cur.sonuc=null;cur.closedAt=null;cur.updatedAt=Date.now();cur.version=(cur.version||0)+1;
                        return cur;
                    },undefined,false);
                    if(!tr.committed)throw new Error('Maç başka cihazdan değişti; yeniden açma durduruldu.');
                    alert('Maç yeniden açıldı. Jüri kayıtları korundu; merkezî bekleyen sonuç kaldırıldı.');
                    return;
                }
                const fixture=await yoneticiFiksturuCoz(kategori,m);
                const f=await db.ref('fikstur/tekSalon_2026_2027').once('value');
                const fikstur=f.val()||{};
                const eskiGalip=m.sonuc?.kazanan?yoneticiFiksturKazanan(m,m.sonuc,fixture):null;
                const sonrakiOyunlar=sonFiksturMacListesi.filter(item=>
                    item.cat===(kategori==='LİSE'?'lise':'ortaokul') && Number(item.no)>fixture.no &&
                    [item.team1,item.team2].some(ad=>skorEslesmeAnahtari(ad)===skorEslesmeAnahtari(eskiGalip)));
                const bagimliMacVar=sonrakiOyunlar.some(item=>fikstur.winners?.[item.no] || fikstur.finalizedMatches?.[item.no]);
                const bagimliBayVar=Object.values(fikstur.bayDraws||{}).some(ad=>skorEslesmeAnahtari(ad)===skorEslesmeAnahtari(eskiGalip));
                if(bagimliMacVar || bagimliBayVar)
                    throw new Error('Bu galip üzerinden sonraki tur sonucu veya BAY kurası kaydedilmiş. Zincirleme sonuç bozulmasın diye maç otomatik açılamaz.');
                if(!confirm('Maç yeniden açılacak. Kesinleşmiş galip ve bu maça ait ağaç sonuçları temizlenecek. Devam edilsin mi?'))return;
                const fr=await db.ref('fikstur/tekSalon_2026_2027').transaction(cur=>{
                    if(!cur || cur.finalizedMatches?.[fixture.no]?.macId!==macId)return;
                    delete cur.finalizedMatches[fixture.no];
                    if(cur.winners)delete cur.winners[fixture.no];
                    if(cur.noWinnerMatches)delete cur.noWinnerMatches[fixture.no];
                    if(cur.winnerSources)delete cur.winnerSources[fixture.no];
                    cur.updatedAt=Date.now();return cur;
                },undefined,false);
                if(!fr.committed)throw new Error('Fikstürde maç sonucu değişti. Otomatik yeniden açma durduruldu.');
                await turnuvaRef(kategori).transaction(state=>{
                    if(!state?.rounds)return;
                    let changed=false;
                    for(const rr of Object.values(state.rounds))for(const entry of Object.values(rr.matches||{})){
                        if(entry.team2!=='BYE' && okulCiftiEslesiyor(entry.team1,entry.team2,fixture.team1,fixture.team2)){
                            entry.winner='';entry.provisionalWinner='';entry.score1=null;entry.score2=null;
                            if(entry.status==='cift_eleme')entry.status='open';changed=true;
                        }
                    }
                    if(!changed)return;
                    state.revision=(state.revision||0)+1;state.updatedAt=Date.now();return state;
                },undefined,false);
                await turnuvaRef(kategori).child('fiksturSonuclari/'+String(fixture.no)).remove();
                await ref.update({durum:'acik',closedAt:null,sonuc:null,updatedAt:Date.now()});
                alert('Maç yeniden açıldı; ilgili fikstür sonucu silindi.');
            }
        }catch(err){
            const message=String(err?.message||err);
            if(yeniDurum==='kapali' && /eşleşm|f[iİ]kstür|jüri|öğrenci|liste|puan|konuşma süresi|son savunma|okul ad/i.test(message)){
                alert('Standart sonuç kesinleştirme tamamlanamadı: '+message+'\n\nŞimdi tüm maçlarda kullanılabilen, resmî maç numarasıyla eşleştirmeli yönetici sonuç ekranı açılacak.');
                void yoneticiManuelSonucEkraniAc(kategori,macId);
            } else alert('İşlem tamamlanamadı: '+message);
        }
        finally{aktifSonucIslemleri.delete(lock);}
    }


    // V3.14: İsimlere bağımlı olmayan, resmî fikstür numarasını yöneticinin
    // iki takım ve taraf eşleştirmesiyle doğruladığı tekil eşleme katmanı.
    // Farklı adla otomatik birleştirme yapılmaz: ekranda açık teyit gerekir.
    let yoneticiFiksturSecenekleri=[];
    async function yoneticiFiksturSecenekleriniOku(kategori){
        const liste=await puanlamaFiksturMaclariniOku();
        const cat=kategori==='LİSE'?'lise':'ortaokul';
        return liste.filter(x=>x.cat===cat && puanlamaGecerliFiksturMaci(x))
            .sort((a,b)=>Number(a.no)-Number(b.no));
    }
    function yoneticiFiksturTarafiniBul(m,fixture){
        if(skorEslesmeAnahtari(m.hukOkul)===skorEslesmeAnahtari(fixture.team1)&&
           skorEslesmeAnahtari(m.muhOkul)===skorEslesmeAnahtari(fixture.team2))return 'ayni';
        if(skorEslesmeAnahtari(m.hukOkul)===skorEslesmeAnahtari(fixture.team2)&&
           skorEslesmeAnahtari(m.muhOkul)===skorEslesmeAnahtari(fixture.team1))return 'ters';
        return '';
    }
    function yoneticiFiksturBaglantiUret(kategori,m,fixture,yon){
        if(!fixture||!puanlamaGecerliFiksturMaci(fixture)||fixture.cat!==(kategori==='LİSE'?'lise':'ortaokul'))
            throw new Error('Yanlış kategori, boş ya da geçersiz resmî fikstür maçı seçildi.');
        if(!['ayni','ters'].includes(yon))throw new Error('Fikstürün 1. ve 2. takımlarına hangi tarafın karşılık geldiğini seçin.');
        const dogrudan=yoneticiFiksturTarafiniBul(m,fixture);
        if(dogrudan && dogrudan!==yon)throw new Error('Takım adları birebir eşleşiyor fakat seçilen taraf yönü ters.');
        return {no:Number(fixture.no),kategori,yon,team1:fixture.team1,team2:fixture.team2,
            kaynak:dogrudan?'isim_ve_numara':'yonetici_eslestirmesi',onayTarihi:Date.now()};
    }
    function yoneticiFiksturBaglantisiKontrol(b,fixture,kategori){
        if(!b||!fixture||b.kategori!==kategori||Number(b.no)!==Number(fixture.no)||
           !['ayni','ters'].includes(b.yon)||fixture.cat!==(kategori==='LİSE'?'lise':'ortaokul')||
           !puanlamaGecerliFiksturMaci(fixture)||
           skorEslesmeAnahtari(b.team1)!==skorEslesmeAnahtari(fixture.team1)||
           skorEslesmeAnahtari(b.team2)!==skorEslesmeAnahtari(fixture.team2))
           throw new Error('Fikstür karşılaşmasının takımları veya numarası değişmiş. Yeniden eşleştirip onaylayın.');
    }
    function yoneticiFiksturKazanan(m,sonuc,fixture){
        const b=sonuc.fiksturBaglantisi;
        if(b){
            yoneticiFiksturBaglantisiKontrol(b,fixture,sonuc.kategori);
            const hukKazandi=skorEslesmeAnahtari(sonuc.kazanan)===skorEslesmeAnahtari(m.hukOkul);
            const muhKazandi=skorEslesmeAnahtari(sonuc.kazanan)===skorEslesmeAnahtari(m.muhOkul);
            if(!hukKazandi&&!muhKazandi)throw new Error('Sonuçtaki galip, maçın okullarından değil.');
            return b.yon==='ayni' ? (hukKazandi?fixture.team1:fixture.team2) : (hukKazandi?fixture.team2:fixture.team1);
        }
        const yon=yoneticiFiksturTarafiniBul(m,fixture);
        if(!yon)throw new Error('Okul adları fikstürle uyuşmuyor. Önce resmî maç numarasını ve tarafları eşleştirin.');
        if(skorEslesmeAnahtari(sonuc.kazanan)===skorEslesmeAnahtari(m.hukOkul))return m.hukOkul===fixture.team1||m.hukOkul===fixture.team2?m.hukOkul:(yon==='ayni'?fixture.team1:fixture.team2);
        if(skorEslesmeAnahtari(sonuc.kazanan)===skorEslesmeAnahtari(m.muhOkul))return m.muhOkul===fixture.team1||m.muhOkul===fixture.team2?m.muhOkul:(yon==='ayni'?fixture.team2:fixture.team1);
        throw new Error('Galip maçın takım listesinde değil.');
    }
    async function yoneticiFiksturuCoz(kategori,m){
        const b=m.sonuc?.fiksturBaglantisi||m.fiksturBaglantisi;
        if(!b)return fiksturEslesmesiniBul(kategori,m.hukOkul,m.muhOkul);
        const liste=await yoneticiFiksturSecenekleriniOku(kategori);
        const bulunan=liste.filter(x=>Number(x.no)===Number(b.no));
        if(bulunan.length!==1)throw new Error('Kaydedilen resmî maç numarası tekil değil veya fikstürden silinmiş.');
        yoneticiFiksturBaglantisiKontrol(b,bulunan[0],kategori);
        sonFiksturMacListesi=liste;
        return bulunan[0];
    }
    function yoneticiFiksturSeciminiGuncelle(){
        const sel=document.getElementById('manuelFiksturNo'),yon=document.getElementById('manuelFiksturYon'),info=document.getElementById('manuelFiksturBilgi');
        if(!sel||!yon||!info)return;
        const f=yoneticiFiksturSecenekleri.find(x=>String(x.no)===sel.value);
        const m=window.yoneticiSonucAktifMaci;
        if(!f){yon.value='';info.textContent='Fikstür maçı seçilmedi. Resmî ağaca aktarım bekleyecek; merkezî sonuç yine kaydedilebilir.';return;}
        const otomatik=m?yoneticiFiksturTarafiniBul(m,f):'';
        if(otomatik)yon.value=otomatik;
        else if(yon.value!== 'ayni' && yon.value!=='ters')yon.value='';
        info.innerHTML=`<b>Resmî #${Number(f.no)}</b> · ${htmlEscape(f.team1)} / ${htmlEscape(f.team2)}<div style="margin-top:6px">${otomatik?'İki taraf ismen eşleşiyor.':'⚠ İsimler farklı! Hükümet ve muhalefetin resmî fikstürde hangi sırada bulunduğunu ayrıca belirtin.'}</div>`;
    }
    async function yoneticiFiksturSecenekleriniGoster(kategori,m,oncekiBaglanti=null){
        const sel=document.getElementById('manuelFiksturNo');if(!sel)return;
        window.yoneticiSonucAktifMaci=m;
        let liste=[],hata='';
        try{liste=await yoneticiFiksturSecenekleriniOku(kategori);}catch(e){hata=String(e?.message||e);}
        yoneticiFiksturSecenekleri=liste;
        const ilk=liste.filter(f=>okulCiftiEslesiyor(f.team1,f.team2,m.hukOkul,m.muhOkul));
        const target=oncekiBaglanti?.no??(ilk.length===1?ilk[0].no:(m.fiksturNo||''));
        sel.innerHTML='<option value="">— Fikstüre şimdi bağlama (yalnız merkezî kayıt) —</option>'+liste.map(f=>
           `<option value="${Number(f.no)}">#${Number(f.no)} · ${htmlEscape(f.team1)} — ${htmlEscape(f.team2)}</option>`).join('');
        if(target!=='' && liste.some(f=>Number(f.no)===Number(target)))sel.value=String(target);
        const yon=document.getElementById('manuelFiksturYon');if(yon && oncekiBaglanti?.yon)yon.value=oncekiBaglanti.yon;
        yoneticiFiksturSeciminiGuncelle();
        const info=document.getElementById('manuelFiksturYukleme');
        if(info){info.textContent=hata?'Fikstür listesi okunamadı: '+hata:'Kategoriye ait '+liste.length+' resmî maç yüklendi. Maç numarası ve tarafları kontrol edin.';}
    }
    function yoneticiFiksturSecimFormu(){
        return `<div class="kriter-card" style="border-color:#365174"><h3 style="margin:0 0 8px;color:#93c5fd">🔗 Resmî Fikstürle Maç Eşleştir — Tüm Maçlar</h3>
           <p class="sure-hint">Okulların adı farklı yazılmışsa isim eşitliği aranmaz. <b>Resmî maç numarasını</b> seçin, iki tarafın karşılığını belirleyin. Yanlış maçın sonucunu etkilememek için teyit zorunludur.</p>
           <label class="puanlama-etiket">Resmî fikstürdeki maç</label>
           <select id="manuelFiksturNo" onchange="document.getElementById('manuelFiksturYon').value='';yoneticiFiksturSeciminiGuncelle()"><option value="">Yükleniyor…</option></select>
           <div id="manuelFiksturBilgi" class="puanlama-bilgi"></div>
           <label class="puanlama-etiket">Hükümet okulumuz resmî fikstürde hangi takım?</label>
           <select id="manuelFiksturYon"><option value="">Tarafları doğrulayın…</option><option value="ayni">1. takım (Hükümet → 1. takım)</option><option value="ters">2. takım (Hükümet → 2. takım)</option></select>
           <label style="display:flex;gap:9px;align-items:flex-start;font-size:12px"><input type="checkbox" id="manuelFiksturOnay" style="width:auto;margin:2px 0 0"><span>Seçtiğim <b>maç numarasının</b>, iki okulun ve <b>takım yönünün</b> doğru olduğunu resmî fikstür/tutanak üzerinden kontrol ettim.</span></label>
           <div id="manuelFiksturYukleme" class="sure-hint">Fikstür karşılaşmaları okunuyor…</div></div>`;
    }
    function yoneticiFiksturFormDegeriniOku(kategori,m){
        const no=document.getElementById('manuelFiksturNo')?.value||'';
        if(!no)return {fixture:null,baglanti:null};
        const fixture=yoneticiFiksturSecenekleri.find(x=>String(x.no)===no);
        if(!fixture)throw new Error('Seçilen maç numarası resmî fikstürde artık bulunmuyor. Listeyi yenileyin.');
        if(yoneticiFiksturSecenekleri.filter(x=>String(x.no)===no).length!==1)
            throw new Error('Aynı kategoride bu maç numarası birden fazla kullanılmış. Resmî fikstürü kontrol edin; otomatik eşleme yapılmaz.');
        if(!document.getElementById('manuelFiksturOnay')?.checked)throw new Error('Maç numarasını ve takım eşleşmesini doğrulama kutusuyla onaylayın.');
        const yon=document.getElementById('manuelFiksturYon')?.value;
        const baglanti=yoneticiFiksturBaglantiUret(kategori,m,fixture,yon);
        return {fixture,baglanti};
    }
    async function yoneticiFiksturCakismaKontrol(kategori,macId,fixture,kazananResmi){
        if(!fixture)return;
        const [fixSnap,macSnap]=await Promise.all([
          db.ref('fikstur/tekSalon_2026_2027').once('value'),db.ref('maclar/'+kategori).once('value')]);
        const fix=fixSnap.val()||{};
        const other=fix.finalizedMatches?.[fixture.no];
        if(other && other.macId!==macId)throw new Error('Bu resmî maç numarası zaten başka bir maç kimliğiyle KESİNLEŞTİRİLMİŞ. Yanlış maçın üzerine yazılmadı.');
        if(other && other.kazanan && skorEslesmeAnahtari(other.kazanan)!==skorEslesmeAnahtari(kazananResmi))
          throw new Error('Aynı maç numarasında başka bir kesin galip bulunuyor.');
        const onceki=fix.winners?.[fixture.no];
        if(onceki&&skorEslesmeAnahtari(onceki)!==skorEslesmeAnahtari(kazananResmi))throw new Error('Resmî fikstürde başka galip kayıtlı. Otomatik üzerine yazılmadı.');
        if(fix.noWinnerMatches?.[fixture.no])throw new Error('Bu resmî karşılaşmaya çift eleme işlenmiş; üzerine galip kaydedilemez.');
        const diger=[];
        macSnap.forEach(c=>{const v=c.val()||{};if(c.key!==macId && v.durum==='kapali' &&
           Number(v.sonuc?.macNo||v.fiksturBaglantisi?.no||0)===Number(fixture.no))diger.push(c.key);});
        if(diger.length)throw new Error('Başka bir kapalı maç aynı resmî maç numarasına bağlı. Çift kayıt engellendi.');
    }
    // V3.13 — Kullanıcının onayladığı sonuçları, jüri kayıtlarını bozmadan
    // ve nedenini arşivleyerek kaydeden yönetici işlemleri.
    // HTML'deki yönetici şifresi Firebase yetkilendirmesinin yerini tutmaz.
    let manuelSonucCalisiyor=false;
    function yoneticiManuelPencereKapat(){
        document.getElementById('yoneticiManuelSonucHost')?.remove();
        window.yoneticiSonucAktifMaci=null;
    }
    function yoneticiManuelToplamDegisti(){
        const h=document.getElementById('manuelPuanHuk')?.value?.trim()||'';
        const m=document.getElementById('manuelPuanMuh')?.value?.trim()||'';
        const kaz=document.getElementById('manuelKazanan');
        if(kaz&&h!==''&&m!==''&&/^\d+$/.test(h)&&/^\d+$/.test(m)){
            if(Number(h)>Number(m))kaz.value='huk';
            if(Number(m)>Number(h))kaz.value='muh';
        }
    }
    async function yoneticiManuelSonucEkraniAc(kategori,macId){
        if(!adminYetkiliMi())return alert('Maç sonuçlarını kesinleştirmek için yönetici girişi gerekir.');
        if(!navigator.onLine||!firebaseBagli)return alert('Maç sonucunu kaydetmek için Firebase bağlantısı gerekiyor.');
        yoneticiManuelPencereKapat();
        try{
            let m;
            try{m=await yoneticiMaciniHazirla(kategori,macId);}
            catch(err){
                // Bilinen #1 maçının operasyon kaydı yoksa kullanıcının açık
                // onayıyla oluştur; fikstür okunamıyorsa sonuç eşitleme bekleyebilir.
                if(kategori!==ACIL_MAC_1.kat||macId!==ACIL_MAC_1.id)throw err;
                if(!confirm('Necip Fazıl İHL — Aras MTAL maçının Firebase operasyon kaydı bulunamadı. Bu iki okulla maç kaydını oluşturmak istiyor musunuz? Fikstür eşleşmesi doğrulanamazsa resmî ağaç daha sonra eşitlenecektir.'))return;
                await ensureMatchExists(kategori,ACIL_MAC_1.huk,ACIL_MAC_1.muh);
                m=await yoneticiMaciniHazirla(kategori,macId);
            }
            if(m.durum!=='acik')return alert('Bu maç zaten kapalı veya iptal edilmiş. Kayıtlı sonucu değiştirmek için önce yönetici panelinden maçı yeniden açın.');
            if(!m.hukOkul||!m.muhOkul)return alert('Maçın her iki okulu belirtilmelidir.');
            const [pSnap,oSnap]=await Promise.all([
                db.ref('puanlar/'+kategori).once('value'),db.ref('okullar/'+kategori).once('value')
            ]);
            const puanlar=snapshotKayitlariniTekillestir(pSnap);
            const okullar=puanlamaRosteriGetir(oSnap);
            const denetim=macTamamlamaOzeti(puanlar,macId,m,okullar);
            const varsayilanH=denetim.ready?denetim.toplamlar[m.hukOkul]:'';
            const varsayilanM=denetim.ready?denetim.toplamlar[m.muhOkul]:'';
            const macBir=kategori===ACIL_MAC_1.kat&&macId===ACIL_MAC_1.id;
            const ph=varsayilanH;
            const pm=varsayilanM;
            const puanKatsayi=puanlar.filter(v=>kayitMacId(v)===macId).length;
            const sorunlar=denetim.sorunlar.slice(0,6);
            const host=document.createElement('div');host.id='yoneticiManuelSonucHost';
            document.body.appendChild(host);
            host.innerHTML=`<div class="sure-modal-bg" role="dialog" aria-modal="true" aria-label="Yönetici onaylı maç sonucu">
              <div class="sure-modal-card" style="width:min(770px,98vw)">
                <h2>✏ Yönetici · Puan Gir ve Sonucu Kesinleştir</h2>
                <div class="puanlama-bilgi"><b>${htmlEscape(m.hukOkul)} — ${htmlEscape(m.muhOkul)}</b>
                  <div>${htmlEscape(kategori)} · Jüri kayıtları: ${puanKatsayi} · 3/3 kontrolü: <b>${denetim.ready?'TAMAM':'EKSİK / UYUŞMUYOR'}</b></div></div>
                ${macBir?`<div class="puanlama-bilgi hata"><b>#1 maçı için 523–622 yalnızca önceki yedekteki referans değerdir.</b>
                    Canlı jüri kayıtlarının bu toplamı verdiği doğrulanmış sayılmaz. Resmî tutanakla karşılaştırarak onaylayın. Yanlış/fazladan puan kayıtları otomatik silinmez.</div>`:''}
                ${!denetim.ready?`<div class="puanlama-bilgi hata">Normal kesinleştirmeyi durduran kontroller:
                    ${sorunlar.length?'<div>'+sorunlar.map(x=>htmlEscape(x)).join('<div></div>')+'</div>':'<div>Jüri veya öğrenci kadrosu henüz tamamlanmadı.</div>'}
                    <div style="margin-top:7px">Bu ekrandaki yönetici kararı jüri puanlarını değiştirmez; önceki maç durumu arşivlenir.</div></div>`:''}
                <label class="puanlama-etiket" for="manuelPuanHuk">${htmlEscape(m.hukOkul)} — toplam puan</label>
                <input type="number" id="manuelPuanHuk" min="0" max="100000" step="1" value="${ph}" oninput="yoneticiManuelToplamDegisti()" placeholder="Puan yoksa boş bırakın">
                <label class="puanlama-etiket" for="manuelPuanMuh">${htmlEscape(m.muhOkul)} — toplam puan</label>
                <input type="number" id="manuelPuanMuh" min="0" max="100000" step="1" value="${pm}" oninput="yoneticiManuelToplamDegisti()" placeholder="Puan yoksa boş bırakın">
                <p class="sure-hint">İki toplamı da yazın veya ikisini de boş bırakıp puansız sonuç kaydedin. Puanlar eşit değilse galip yüksek puanlı okul olmalıdır.</p>
                <label class="puanlama-etiket" for="manuelKazanan">Galip okul</label>
                <select id="manuelKazanan"><option value="">Galibi seçin</option>
                    <option value="huk">${htmlEscape(m.hukOkul)}</option>
                    <option value="muh">${htmlEscape(m.muhOkul)}</option></select>
                ${yoneticiFiksturSecimFormu()}
                <label class="puanlama-etiket" for="manuelSonucGerekce">Yönetici notu (isteğe bağlı)</label>
                <textarea id="manuelSonucGerekce" rows="3" placeholder="İsterseniz kısa bir not yazabilirsiniz."></textarea>
                <label style="display:flex;align-items:center;gap:10px;margin:12px 0;font-size:12px"><input id="manuelSonucOnay" type="checkbox" style="width:auto;margin:0">
                     Galip okulu ve girdiğim puanları kontrol ettim; sonucu kesinleştirmeyi onaylıyorum.</label>
                <button id="manuelSonucKaydetBtn" class="btn" style="background:#0f766e" onclick="yoneticiManuelSonucKaydet('${kategori}','${macId}')">✓ Onaylı Sonucu Firebase'e Kaydet</button>
                <button class="btn" onclick="yoneticiManuelPencereKapat()">Vazgeç</button>
              </div></div>`;
            yoneticiManuelToplamDegisti();
            await yoneticiFiksturSecenekleriniGoster(kategori,m,m.fiksturBaglantisi||m.sonuc?.fiksturBaglantisi);
        }catch(err){yoneticiManuelPencereKapat();alert('Sonuç ekranı açılamadı: '+String(err?.message||err));}
    }
    async function yoneticiManuelSonucKaydet(kategori,macId){
        if(manuelSonucCalisiyor)return;
        if(!adminYetkiliMi()||!navigator.onLine||!firebaseBagli)return alert('Çevrimiçi yönetici girişi gerekir.');
        const hs=document.getElementById('manuelPuanHuk')?.value?.trim()??'';
        const ms=document.getElementById('manuelPuanMuh')?.value?.trim()??'';
        const taraf=document.getElementById('manuelKazanan')?.value;
        const gerekce=puanMetniNormalize(document.getElementById('manuelSonucGerekce')?.value||'');
        const kabul=document.getElementById('manuelSonucOnay')?.checked;
        if(!taraf||!['huk','muh'].includes(taraf))return alert('Galip okul seçilmelidir.');
        
        if(!kabul)return alert('Sonuç doğrulama kutusunu işaretlemeniz gerekir.');
        if((hs==='')!==(ms===''))return alert('İki toplamı da yazın veya ikisini de boş bırakın.');
        const sayisal=hs!=='';
        if(sayisal&&(!/^\d+$/.test(hs)||!/^\d+$/.test(ms)||!Number.isSafeInteger(Number(hs))||!Number.isSafeInteger(Number(ms))||Number(hs)>100000||Number(ms)>100000))
            return alert('Puanlar 0–100000 aralığında tam sayı olmalıdır.');
        const ph=sayisal?Number(hs):null,pm=sayisal?Number(ms):null;
        if(sayisal&&ph!==pm&&taraf!==(ph>pm?'huk':'muh'))return alert('Galip, yüksek puanlı okul olmalıdır. Puanları veya seçimi kontrol edin.');
        manuelSonucCalisiyor=true;
        const btn=document.getElementById('manuelSonucKaydetBtn');if(btn){btn.disabled=true;btn.textContent='Kaydediliyor…';}
        const lock=kategori+'|'+macId;
        if(aktifSonucIslemleri.has(lock)){manuelSonucCalisiyor=false;if(btn){btn.disabled=false;btn.textContent='✓ Onaylı Sonucu Firebase\'e Kaydet';}return alert('Bu maçta başka bir sonuç işlemi sürüyor.');}
        aktifSonucIslemleri.add(lock);
        try{
            const m=await yoneticiMaciniHazirla(kategori,macId);
            if(m.durum!=='acik')throw new Error('Maç başka bir cihazda kapatılmış veya iptal edilmiş.');
            const kazanan=taraf==='huk'?m.hukOkul:m.muhOkul;
            const maglup=taraf==='huk'?m.muhOkul:m.hukOkul;
            // Eşleşme adlarla bulunmak zorunda değil. Yöneticinin bu ekranda
            // seçtiği resmî maç numarası ve takım yönü esas alınır.
            const {fixture,baglanti}=yoneticiFiksturFormDegeriniOku(kategori,m);
            const fiksturKazanan=fixture?yoneticiFiksturKazanan(m,{kazanan,kategori,fiksturBaglantisi:baglanti},fixture):null;
            if(fixture)await yoneticiFiksturCakismaKontrol(kategori,macId,fixture,fiksturKazanan);
            const eslesmeHata=fixture?'':'Resmî maç numarası seçilmedi. Sonuç merkezî olarak kaydedilecek; fikstür eşitlemesi bekleyecek.';
            const warn=fixture?'Resmî fikstür ve merkezî turnuva ağacına da aktarılacak.':
                'DİKKAT: Fikstürde eşleşme bulunamadı. Maç sonucu merkezi Firebase maç kaydında KAPALI olarak tutulacak, ancak resmi turnuva ağacına aktarılmayacak.\n'+eslesmeHata;
            if(!confirm(`YÖNETİCİ SONUÇ ONAYI\n\n${m.hukOkul}: ${sayisal?ph:'Belirtilmedi'}\n${m.muhOkul}: ${sayisal?pm:'Belirtilmedi'}\nGALİP: ${kazanan}\nNOT: ${gerekce||"Yönetici onayı"}\n\n${warn}\n\nMevcut jüri kayıtları silinmeyecek. Sonucu kesinleştirelim mi?`))return;
            // Her iki takımın önceki durumları ve tüm bu maça ait ham jüri kayıtları
            // sunucuya arşivlenmeden kapatma yapılmaz.
            const pSnap=await db.ref('puanlar/'+kategori).once('value');
            const raw=yoneticiMacaAitHamPuanlar(pSnap,macId);
            const sonuc={kazanan,maglup,yontem:sayisal?'yonetici_onayli_puan':'yonetici_karari',
                gerekce:gerekce||"Yönetici onayı",puanHuk:ph,puanMuh:pm,macNo:fixture?.no||null,kategori,macId,
                sureHuk:m.sureEsitlik?.hukSaniye??null,sureMuh:m.sureEsitlik?.muhSaniye??null,
                createdAt:Date.now(),senkronDurum:fixture?'bekliyor':'fikstur_eslesme_gerekli',
                fiksturBaglantisi:baglanti,fiksturKazanan,
                yoneticiIstisnasi:true,puanKayitSayisi:Object.keys(raw).length,
                kaynak:'yonetici_onayli_sonuc'};
            const auditPath=`arsiv/yoneticiKararlari/${kategori}/${Date.now()}_${macId}_resmi_sonuc`;
            await db.ref(auditPath).set({kategori,macId,mac:{...m},sonuc,
                oncekiPuanKayitlari:raw,fiksturEslesmeHatasi:eslesmeHata,
                islemDurumu:'hazirlandi',createdAt:firebase.database.ServerValue.TIMESTAMP});
            const ref=db.ref(`maclar/${kategori}/${macId}`);
            const applied=await ref.transaction(cur=>{
                if(!cur || cur.durum!=='acik'||cur.updatedAt!==m.updatedAt||
                    skorEslesmeAnahtari(cur.hukOkul)!==skorEslesmeAnahtari(m.hukOkul)||
                    skorEslesmeAnahtari(cur.muhOkul)!==skorEslesmeAnahtari(m.muhOkul))return;
                cur.durum='kapali';cur.closedAt=Date.now();cur.updatedAt=Date.now();
                cur.version=(cur.version||0)+1;cur.sonuc=sonuc;
                if(baglanti){cur.fiksturBaglantisi=baglanti;cur.fiksturNo=Number(fixture.no);}
                return cur;
            },undefined,false);
            if(!applied.committed)throw new Error('Maç başka cihazda değişti; sonuç işlenmedi. Lütfen yeniden açıp kontrol edin.');
            try{await db.ref(auditPath).update({islemDurumu:'mac_kapatildi',closedAt:firebase.database.ServerValue.TIMESTAMP});}
            catch(e){console.warn('Denetim kapanış durum bilgisi yazılamadı:',e);}
            let synced=false;
            if(fixture){
                try{await macSonucunuIkiAgacaYansit(kategori,macId,applied.snapshot.val(),sonuc,fixture);synced=true;}
                catch(e){console.error('Onaylı sonuç ağaca eşitlenemedi:',e);eslesmeHata=String(e?.message||e);}
            }
            yoneticiManuelPencereKapat();
            alert(synced?'✅ Maçın onaylı sonucu ve galibi resmî fikstüre kaydedildi. Jüri puanları korundu.':
                '✅ Maç sonucu merkezi Firebase kaydına KESİNLEŞTİRİLDİ. Ancak resmî fikstüre aktarım henüz tamamlanmadı. Yönetici panelinde Senkronu Onar seçeneğini kontrol edin.\nAyrıntı: '+(eslesmeHata||'Fikstürde eşleşme yok.'));
            if(document.getElementById('acilMacDenetim'))void acilMacDenetle();
        }catch(err){alert('Resmî sonuç kaydedilemedi: '+String(err?.message||err));}
        finally{aktifSonucIslemleri.delete(lock);manuelSonucCalisiyor=false;if(btn&&btn.isConnected){btn.disabled=false;btn.textContent='✓ Onaylı Sonucu Firebase\'e Kaydet';}}
    }
    async function yoneticiFiksturSonucEslestirEkraniAc(kategori,macId){
        if(!adminYetkiliMi()||!navigator.onLine||!firebaseBagli)return alert('Çevrimiçi yönetici girişi gerekir.');
        yoneticiManuelPencereKapat();
        try{
            const m=await yoneticiMaciniHazirla(kategori,macId);
            if(m.durum!=='kapali'||!m.sonuc?.kazanan)return alert('Önce sonuç kaydedilmiş bir maç seçin.');
            const host=document.createElement('div');host.id='yoneticiManuelSonucHost';document.body.appendChild(host);
            host.innerHTML=`<div class="sure-modal-bg" role="dialog" aria-modal="true"><div class="sure-modal-card" style="width:min(760px,98vw)">
                <h2>🔗 Kapanmış Maçı Resmî Fikstürle Eşleştir</h2>
                <div class="puanlama-bilgi">${htmlEscape(m.hukOkul)} — ${htmlEscape(m.muhOkul)}<div>Kaydedilmiş galip: <b>${htmlEscape(m.sonuc.kazanan)}</b>. Bu işlem <b>puanı, galibi, jüri kayıtlarını değiştirmez</b>; resmî maç numarası ve takım adları eşleştirilir.</div></div>
                ${yoneticiFiksturSecimFormu()}
                <label class="puanlama-etiket">Eşleştirme gerekçesi</label><textarea id="manuelBaglantiGerekce" rows="2" placeholder="Ör. Fikstürde okulun kısa adı kullanılmıştır; 12. maç tutanağı ile doğrulandı."></textarea>
                <button id="manuelBaglantiKaydetBtn" class="btn" style="background:#0f766e" onclick="yoneticiKapaliMacFikstureBagla('${kategori}','${macId}')">✓ Eşleştir ve Resmî Ağaca Aktar</button>
                <button class="btn" onclick="yoneticiManuelPencereKapat()">Vazgeç</button>
            </div></div>`;
            await yoneticiFiksturSecenekleriniGoster(kategori,m,m.sonuc.fiksturBaglantisi||m.fiksturBaglantisi);
        }catch(err){yoneticiManuelPencereKapat();alert('Fikstür eşleştirme ekranı açılamadı: '+String(err?.message||err));}
    }
    async function yoneticiKapaliMacFikstureBagla(kategori,macId){
        if(!adminYetkiliMi()||!firebaseBagli)return alert('Yönetici ve Firebase bağlantısı gerekli.');
        const lock=kategori+'|'+macId;
        if(aktifSonucIslemleri.has(lock))return;
        aktifSonucIslemleri.add(lock);
        const btn=document.getElementById('manuelBaglantiKaydetBtn');if(btn)btn.disabled=true;
        try{
            const m=await yoneticiMaciniHazirla(kategori,macId);
            if(m.durum!=='kapali'||!m.sonuc?.kazanan)throw new Error('Maç kapalı ve galibi kayıtlı olmalıdır.');
            const {fixture,baglanti}=yoneticiFiksturFormDegeriniOku(kategori,m);
            if(!fixture)throw new Error('Resmî fikstür maç numarasını seçin.');
            const gerekce=puanMetniNormalize(document.getElementById('manuelBaglantiGerekce')?.value||'');
            if(gerekce.length<12)throw new Error('Eşleştirme gerekçesi en az 12 karakter olmalı.');
            if(m.sonuc.macNo!=null&&Number(m.sonuc.macNo)!==Number(fixture.no))
                throw new Error('Sonuç zaten farklı bir maç numarasıyla kayıtlı. Önce çelişkiyi inceleyin; otomatik taşımaya izin verilmez.');
            const sonuc={...m.sonuc,fiksturBaglantisi:baglanti,macNo:Number(fixture.no),senkronDurum:'bekliyor',fiksturKazanan:null};
            sonuc.fiksturKazanan=yoneticiFiksturKazanan(m,sonuc,fixture);
            await yoneticiFiksturCakismaKontrol(kategori,macId,fixture,sonuc.fiksturKazanan);
            if(!confirm(`RESMÎ FİKSTÜR EŞLEŞTİRME ONAYI\n\nMerkez: ${m.hukOkul} — ${m.muhOkul}\nResmî #${fixture.no}: ${fixture.team1} — ${fixture.team2}\nResmî galip: ${sonuc.fiksturKazanan}\nGerekçe: ${gerekce}\n\nJüri puanları ve sonuç değerleri KORUNACAK. Devam mı?`))return;
            const auditPath=`arsiv/yoneticiKararlari/${kategori}/${Date.now()}_${macId}_fikstur_eslestirme`;
            await db.ref(auditPath).set({kategori,macId,oncekiSonuc:m.sonuc,baglanti,gerekce,
                islem:'kapali_mac_eslestirme',createdAt:firebase.database.ServerValue.TIMESTAMP});
            const applied=await db.ref(`maclar/${kategori}/${macId}`).transaction(cur=>{
                if(!cur||cur.durum!=='kapali'||cur.updatedAt!==m.updatedAt||
                   cur.sonuc?.kazanan!==m.sonuc.kazanan||
                   Number(cur.sonuc?.macNo||0)!==Number(m.sonuc.macNo||0))return;
                cur.sonuc=sonuc;cur.fiksturBaglantisi=baglanti;cur.fiksturNo=Number(fixture.no);
                cur.updatedAt=Date.now();cur.version=(cur.version||0)+1;return cur;
            },undefined,false);
            if(!applied.committed)throw new Error('Maç verisi başka cihazdan değişmiş. Yeniden kontrol edin.');
            let err='';try{await macSonucunuIkiAgacaYansit(kategori,macId,applied.snapshot.val(),sonuc,fixture);}catch(e){err=String(e?.message||e);}
            yoneticiManuelPencereKapat();
            alert(err?'Maç numarası ve eşleştirme kaydedildi; ancak resmî ağaç senkronu tamamlanamadı: '+err:'✅ Kayıtlı maç sonucu, ad farklılığı olmadan resmî fikstüre aktarıldı.');
        }catch(err){alert('Eşleştirme yapılamadı: '+String(err?.message||err));}
        finally{aktifSonucIslemleri.delete(lock);if(btn?.isConnected)btn.disabled=false;}
    }
    async function yoneticiManuelMacEkleEkraniAc(){
        if(!adminYetkiliMi())return alert('Maç oluşturmak için yönetici girişi gerekir.');
        dinleyicileriTemizle();
        document.getElementById('app').innerHTML=`<div class="card" style="max-width:870px">
          <h2>＋ Yeni / Manuel Maç Kaydet</h2>
          <div class="puanlama-bilgi">Bu bölüm, fikstürde henüz görünmeyen karşılaşmalar için iki okulla maç kaydı oluşturur. Kayıt jüri ekranında ve süre ekranında seçilebilir. Resmî fikstürde eşleşmesi olmayan maçların sonuçları otomatik olarak turnuva ağacına yazılamaz.</div>
          <label class="puanlama-etiket">Kategori</label>
          <select id="ekMacKategori"><option value="ORTAOKUL">ORTAOKUL</option><option value="LİSE">LİSE</option></select>
          <label class="puanlama-etiket">Hükümet okulu</label><input id="ekMacHuk" list="ekMacOkullar" placeholder="Okul adı (tam yazılış)">
          <label class="puanlama-etiket">Muhalefet okulu</label><input id="ekMacMuh" list="ekMacOkullar" placeholder="Diğer okulun adı">
          <datalist id="ekMacOkullar"></datalist>
          <div class="sure-hint">Mevcut okul isimlerini kullanmanız öğrencileri otomatik eşleştirir. Yeni adla kayıt oluşturursanız ilgili öğrencileri ayrıca kaydetmelisiniz.</div>
          <button class="btn" style="background:#0f766e" onclick="yoneticiManuelMacKaydet()">✓ Maçı Kaydet</button>
          <button class="btn" onclick="renderYoneticiCanliPanel()">← Maç Yönetimine Dön</button>
        </div>`;
        const cat=document.getElementById('ekMacKategori');cat.value=secimler.kategori;
        const populate=async()=>{
            try{const snap=await db.ref('okullar/'+cat.value).once('value');
                const datalist=document.getElementById('ekMacOkullar');if(datalist)datalist.innerHTML=Object.keys(snap.val()||{}).sort((a,b)=>a.localeCompare(b,'tr')).map(n=>`<option value="${htmlEscape(n)}"></option>`).join('');}
            catch(e){console.warn('Manuel maç okul listesi okunamadı:',e);}
        };
        cat.onchange=populate;void populate();
    }
    async function yoneticiManuelMacKaydet(){
        if(!adminYetkiliMi()||!firebaseBagli||!navigator.onLine)return alert('Maç kaydı için çevrimiçi yönetici girişi gerekir.');
        const kat=document.getElementById('ekMacKategori')?.value;
        const huk=puanMetniNormalize(document.getElementById('ekMacHuk')?.value||'');
        const muh=puanMetniNormalize(document.getElementById('ekMacMuh')?.value||'');
        if(!['LİSE','ORTAOKUL'].includes(kat)||!huk||!muh)return alert('Kategori ve iki okul zorunludur.');
        if(skorEslesmeAnahtari(huk)===skorEslesmeAnahtari(muh))return alert('Karşılaşmada iki farklı okul olmalıdır.');
        if(!confirm(`${kat}\n${huk} — ${muh}\n\nMaç Firebase'de kayıtlı değilse oluşturulacak. Devam edilsin mi?`))return;
        try{
            const id=await ensureMatchExists(kat,huk,muh);
            const ref=db.ref(`maclar/${kat}/${id}`);
            await ref.transaction(cur=>{
                if(!cur||cur.kaynak||cur.fiksturNo)return;
                cur.kaynak='yonetici_manuel';cur.updatedAt=Date.now();return cur;
            },undefined,false);
            secimler.kategori=kat;secimleriKaydet();
            alert('Maç kaydı oluşturuldu veya mevcut kayıt bulundu. Maç yönetimi, jüri ve süre ekranlarında seçilebilir.');
            renderYoneticiCanliPanel();
        }catch(err){alert('Maç kaydedilemedi: '+String(err?.message||err));}
    }

    // V3.11 - Bu veri onarımı YALNIZCA belirli maç ve doğrulanmış yedek örüntüsüne uygulanır.
    // Sayfa açılışında veri YAZMAZ. Yöneticinin açık onayı ve canlı Firebase kıyaslaması şarttır.
    const ACIL_MAC_1={kat:'LİSE',id:'m_da8e85d7e0ffabb5',huk:'Necip Fazıl İHL',muh:'Aras MTAL',
        hataliKayit:'p_cb9ef6da375b0894',beklenenHuk:523,beklenenMuh:622,macNo:1};
    let acilMacOnarimCalisiyor=false;
    function acilMacPuanKontrol(puanlar,roster,m){
        const c=ACIL_MAC_1;
        if(!m||skorEslesmeAnahtari(m.hukOkul)!==skorEslesmeAnahtari(c.huk)||skorEslesmeAnahtari(m.muhOkul)!==skorEslesmeAnahtari(c.muh))
            throw new Error('Canlı maç bilgileri beklenen okullarla eşleşmiyor; otomatik onarım uygulanmayacak.');
        const kayitlar=Object.entries(puanlar||{}).filter(([,v])=>v?.secim&&kayitMacId(v)===c.id);
        const supheli=puanlar?.[c.hataliKayit];
        const supheliVar=!!(supheli?.secim&&kayitMacId(supheli)===c.id);
        if(supheliVar && (!/Muhammed Eren TAŞ \(1\. Konuşmacı\)/iu.test(supheli.secim.ogr)||
            supheli.secim.juri!=='1. Jüri'||supheli.secim.okul!==c.huk||puanToplami(supheli)!==59))
            throw new Error('Fazladan olduğu düşünülen kayıt, yedekteki 59 puanlık kayıtla uyuşmuyor. Manuel denetim gerekiyor.');
        const raw=kayitlar.filter(([k])=>k!==c.hataliKayit).map(([k,v])=>({...v,_firebaseKey:k}));
        if(raw.length!==18||kayitlar.length!==(supheliVar?19:18))
            throw new Error('Canlı kayıtlarda beklenen 18 geçerli + 1 şüpheli jüri kaydı düzeni yok. Başka kayıtlar değişmiş olabilir.');
        const m2={...m,ogrenciKaynaklari:{huk:c.huk,muh:Object.keys(roster||{}).find(n=>skorEslesmeAnahtari(n)===skorEslesmeAnahtari(c.muh))||c.muh}};
        const g=macTamamlamaOzeti(raw,c.id,m2,roster);
        const huk=Number(g.toplamlar[c.huk]||0),muh=Number(g.toplamlar[c.muh]||0);
        if(!g.ready||g.tam!==6||g.total!==6||huk!==c.beklenenHuk||muh!==c.beklenenMuh)
            throw new Error('Kayıt denetimi başarısız: '+g.sorunlar.slice(0,4).join(' | ')+'; toplamlar '+huk+' / '+muh+'. Veri kendiliğinden değiştirilmeyecek.');
        if(!roster[c.huk]?.length || !roster[m2.ogrenciKaynaklari.muh]?.length)
            throw new Error('Öğrenci listelerinden biri canlı veritabanında bulunamadı.');
        return {huk,muh,gecerli:raw.length,fazladan:supheliVar?1:0,supheli:supheliVar?supheli:null,kaynaklar:m2.ogrenciKaynaklari};
    }
    function acilSupheliKayitEsitMi(a,b){
        if(!a||!b)return false;
        const norm=v=>puanMetniNormalize(v);
        const same=(x,y)=>norm(x)===norm(y);
        const sa=a.secim||{},sb=b.secim||{};
        return same(a.macId||sa.macId,b.macId||sb.macId)
            && same(sa.okul,sb.okul) && same(sa.ogr,sb.ogr)
            && same(sa.juri,sb.juri) && same(sa.taraf,sb.taraf)
            && same(sa.kategori,sb.kategori) && a.createdAt===b.createdAt
            && krit.every((_,i)=>Number(a.puanlar?.[i]??a.puanlar?.[String(i)])===Number(b.puanlar?.[i]??b.puanlar?.[String(i)]));
    }
    async function acilMacCanliVeriOku(){
        const c=ACIL_MAC_1;
        const [m,p,o,f]=await Promise.all([
            db.ref(`maclar/${c.kat}/${c.id}`).once('value'),
            db.ref(`puanlar/${c.kat}`).once('value'),
            db.ref(`okullar/${c.kat}`).once('value'),
            db.ref('fikstur/tekSalon_2026_2027').once('value')]);
        return {m:m.val(),puanlar:p.val()||{},roster:puanlamaRosteriGetir(o),fixture:f.val()||{}};
    }
    // V3.13: #1 incelemesi artık 18+1 kayıt kalıbını mutlak önkoşul saymaz.
    // Kayıtlar otomatik silinmez; onaylı sonuç sayısal olarak ayrı tutulur.
    async function renderAcilMacOnarimi(){
        if(!adminYetkiliMi())return sifreliModulKontrol('yonetici');
        dinleyicileriTemizle();
        document.getElementById('app').innerHTML=`<div class="card" style="max-width:930px">
            <h2>🩺 Maç #1 · Necip Fazıl İHL — Aras MTAL</h2>
            <div class="puanlama-bilgi"><b>LİSE · Önceki yedek referansı: 523 – 622</b> · Önerilen galip: Aras MTAL.
                <div class="sure-hint">Bu rakamlar canlı Firebase üzerinden henüz yeniden doğrulanmadı. Aşağıdaki kontrol sonucunu resmî tutanakla karşılaştırın.</div></div>
            <div id="acilMacDenetim" class="puanlama-bilgi">Canlı kayıtlar okunuyor…</div>
            <div class="sure-hint">Önceki sürüm, tam 18 geçerli + 1 şüpheli puan kaydı ve belirli okul adı eşleşmesini zorunlu tuttuğu için işlemi durdurabiliyordu. Yeni sonuç kaydı, jüri kayıtlarını otomatik silmez veya değiştirmez; gerekçe ve onayla ayrı resmî sonuç oluşturur.</div>
            <button id="acilMacOnarBtn" class="btn" style="background:#0f766e" onclick="acilMacOnarimUygula()">📋 Onaylı Resmî Sonuç Gir / Kesinleştir</button>
            <button class="btn" onclick="acilMacDenetle()">↻ Firebase Kayıtlarını Yeniden Kontrol Et</button>
            <button class="btn" onclick="renderYoneticiCanliPanel()">← Tüm Maçlar</button>
            <button class="btn" style="background:#475569" onclick="renderYoneticiMenu()">← Yönetici Modülü</button>
        </div>`;
        await acilMacDenetle();
    }
    async function acilMacDenetle(){
        const el=document.getElementById('acilMacDenetim');
        if(!el)return;
        el.className='puanlama-bilgi';
        el.textContent='Canlı kayıtlar okunuyor…';
        if(!firebaseBagli||!navigator.onLine){el.className='puanlama-bilgi hata';el.textContent='Firebase bağlantısı yok. Canlı puanlar okunamıyor.';return;}
        try{
            const {m,puanlar,roster,fixture}=await acilMacCanliVeriOku(),c=ACIL_MAC_1;
            const rows=Object.entries(puanlar||{}).filter(([,v])=>v?.secim&&kayitMacId(v)===c.id);
            const say={huk:0,muh:0,diger:0};
            const seen=new Map(),supheli=[];
            for(const [key,v] of rows){
                const okul=skorEslesmeAnahtari(v.secim?.okul);
                if(okul===skorEslesmeAnahtari(c.huk))say.huk+=puanToplami(v);
                else if(okul===skorEslesmeAnahtari(c.muh))say.muh+=puanToplami(v);
                else say.diger++;
                const identity=[skorEslesmeAnahtari(v.secim?.okul),skorEslesmeAnahtari(v.secim?.ogr?.split(' (')[0]),v.secim?.juri].join('|');
                if(seen.has(identity))supheli.push(key);
                seen.set(identity,key);
                if(key===c.hataliKayit) supheli.push(key);
            }
            const fmt=m?.durum==='kapali'?'KESİNLEŞTİRİLMİŞ':m?.durum||'Henüz operasyon kaydı yok';
            const saved=m?.sonuc||{};
            const savedScore=Number.isFinite(saved.puanHuk)&&Number.isFinite(saved.puanMuh)?`${saved.puanHuk} / ${saved.puanMuh}`:'—';
            const names=Object.keys(roster||{});
            const hasH=names.some(n=>skorEslesmeAnahtari(n)===skorEslesmeAnahtari(c.huk));
            const hasM=names.some(n=>skorEslesmeAnahtari(n)===skorEslesmeAnahtari(c.muh));
            el.innerHTML=`<b>Canlı Firebase okuması tamamlandı.</b>
                <div>Bu maç için bulunan ham jüri kayıtları: <b>${rows.length}</b>.</div>
                <div>Ham puanların okul adına göre toplamı: <b>${say.huk} / ${say.muh}</b>. ${say.diger?'Farklı okul adına yazılmış kayıt: '+say.diger+'.':''}</div>
                <div>Aynı öğrenci/jüri eşleşmesi veya önceki şüpheli ID: <b>${new Set(supheli).size} kayıt uyarısı</b>.</div>
                <div>Öğrenci listeleri: Necip Fazıl ${hasH?'bulundu':'eksik/farklı ad'}, Aras MTAL ${hasM?'bulundu':'eksik/farklı ad'}.</div>
                <div>Maç durumu: <b>${htmlEscape(fmt)}</b>${saved.kazanan?' · Kaydedilmiş galip: '+htmlEscape(saved.kazanan):''}; resmî kayıt puanı: <b>${savedScore}</b>.</div>
                <div>Fikstür #1 sonucu: <b>${htmlEscape(fixture.winners?.[1]||'Henüz girilmedi')}</b>.</div>
                <div class="sure-hint">Ham toplam ile önceki 523–622 tutanağı uyuşmuyorsa yanlış kaydı rastgele silmeyin. Onaylı resmî sonucu gerekçe göstererek ayrı kaydedin.</div>`;
        }catch(err){el.className='puanlama-bilgi hata';el.textContent='Canlı denetim sırasında hata: '+String(err?.message||err)+' · Onaylı sonuç girişinden önce Firebase erişimini kontrol edin.';}
    }
    async function acilMacOnarimUygula(){
        if(!adminYetkiliMi())return alert('Yönetici yetkisi gerekiyor.');
        await yoneticiManuelSonucEkraniAc(ACIL_MAC_1.kat,ACIL_MAC_1.id);
    }

    async function yedekVerisiniGetir(kategori) {
        const [o,p,m,t,f]=await Promise.all([db.ref('okullar/'+kategori).once('value'),db.ref('puanlar/'+kategori).once('value'),db.ref('maclar/'+kategori).once('value'),db.ref('turnuva/'+kategori).once('value'),db.ref('fikstur/tekSalon_2026_2027').once('value')]);
        return {meta:{appVersion:APP_VERSION,kategori,createdAt:new Date().toISOString()},okullar:o.val()||{},puanlar:p.val()||{},maclar:m.val()||{},turnuva:t.val()||{},fiksturOrtak:f.val()||{}};
    }

    async function yedekJsonIndir() {
        try { const data=await yedekVerisiniGetir(secimler.kategori); const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}); const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`Munazara_Yedek_${secimler.kategori}_${new Date().toISOString().replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);} catch(err){alert('Yedek indirilemedi: '+(err?.message||err));}
    }

    async function firebaseArsivYedegiAl(sessiz=false, etiket='manuel') {
        try { const data=await yedekVerisiniGetir(secimler.kategori); const key=`${Date.now()}_${etiket}`; await db.ref(`arsiv/tamYedek/${secimler.kategori}/${key}`).set(data); if(!sessiz)alert('Firebase arşiv yedeği oluşturuldu.'); } catch(err){if(!sessiz)alert('Arşiv yedeği oluşturulamadı: '+(err?.message||err));}
    }

    