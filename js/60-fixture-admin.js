    async function fiksturRakipsizOkuluUstTurdaEslestir(m,opponentMatchNo,reason){
      if(!adminYetkiliMi()||!firebaseBagli||!navigator.onLine)throw new Error('Çevrimiçi yönetici yetkisi gerekli.');
      if(!m||Number(m.no)!==35||m.cat!=='ortaokul'||!m.isPending)throw new Error('Bu işlem yalnızca rakibi belirlenmemiş ortaokul #35 için kullanılabilir.');
      const realSchool=x=>!!x&&!['boş','bay'].includes(fiksturIstisnaNorm(x));
      const school=[m.team1,m.team2].find(realSchool);
      if(!school)throw new Error('35. maçta gerçek okul bulunamadı.');
      if(reason.length<12)throw new Error('Gerekçe en az 12 karakter olmalıdır.');
      const opponentNo=Number(opponentMatchNo);
      if(!Number.isInteger(opponentNo)||opponentNo<11||opponentNo>34)throw new Error('Geçerli bir 1. tur galibi seçiniz.');
      const macId=macKimligiOlustur('ORTAOKUL',m.team1,m.team2);
      const [currentSnap,scoreSnap,matchSnap]=await Promise.all([
        db.ref(FIKSTUR_ISTISNA_YOLU).once('value'),
        db.ref('puanlar/ORTAOKUL').once('value'),
        db.ref('maclar/ORTAOKUL/'+macId).once('value')
      ]);
      const current=currentSnap.val();
      if(!current||!current.juries||!current.topics)throw new Error('Merkezî fikstür yüklenemedi.');
      let scored=false;scoreSnap.forEach(c=>{if(kayitMacId(c.val())===macId)scored=true;});
      if(scored||matchSnap.val()?.sonuc)throw new Error('35. maçta puan veya sonuç kaydı var. Puanlı karşılaşma yeniden eşleştirilemez.');
      if(current.winners?.[35]&&current.winners[35]!==school)throw new Error('35. maçta farklı bir galip kayıtlı.');
      if(current.finalizedMatches?.[35])throw new Error('35. maçta kesinleşmiş sonuç kaydı var.');
      const winners=current.winners||{};
      const firstRoundWinners=Array.from({length:24},(_,i)=>({no:11+i,school:winners[11+i]}));
      if(firstRoundWinners.some(x=>!x.school))throw new Error('Önce ortaokul 1. turdaki 24 maçın tamamının galibi kesinleşmeli.');
      const opponent=firstRoundWinners.find(x=>x.no===opponentNo)?.school;
      if(!opponent)throw new Error('Seçilen 1. tur galibi artık mevcut değil; listeyi yenileyin.');
      if(fiksturIstisnaNorm(opponent)===fiksturIstisnaNorm(school))throw new Error('Okul kendisiyle eşleştirilemez.');
      const previousBays=Object.entries(current.bayDraws||{}).filter(([k])=>k!=='orta_r2').map(([,v])=>fiksturIstisnaNorm(v));
      if(previousBays.includes(fiksturIstisnaNorm(opponent)))throw new Error('Seçilen rakip daha önce BAY kullanmış; başka bir rakip seçin.');
      const later=Object.keys(winners).some(x=>Number(x)>=41&&Number(x)<=53)||
        Object.keys(current.finalizedMatches||{}).some(x=>Number(x)>=41&&Number(x)<=53)||
        ['orta_r3','orta_r4','orta_sf'].some(x=>!!current.bayDraws?.[x]);
      if(later)throw new Error('Ortaokul 2. tur veya sonraki turlarda sonuç/BAY kaydı var. Fikstür güvenliği için eşleşme değiştirilemez.');
      const byeCandidates=firstRoundWinners.map(x=>x.school)
        .filter(x=>fiksturIstisnaNorm(x)!==fiksturIstisnaNorm(opponent)&&!previousBays.includes(fiksturIstisnaNorm(x)));
      if(!byeCandidates.length)throw new Error('Şevki Akgün ve seçilen rakip dışında BAY verilebilecek uygun takım bulunamadı.');
      const byeTeam=byeCandidates[Math.floor(Math.random()*byeCandidates.length)];
      const display='#35 · '+school+'\n2. tur rakibi: #'+opponentNo+' galibi · '+opponent+
        '\nDiğer BAY hakkı: '+byeTeam+'\nGerekçe: '+reason+
        '\n\nŞevki Akgün gerçek bir 2. tur maçı yapacak. BAY, kalan takımlardan birine kura ile verilecek.';
      if(!confirm('2. TUR EŞLEŞMESİNİ ONAYLA\n\n'+display+'\nDevam edilsin mi?'))return;
      const auditRef=db.ref('arsiv/fiksturDegisiklikleri/'+Date.now()+'_35_pair');
      await auditRef.set({before:current,school,opponent,opponentMatchNo:opponentNo,byeTeam,reason,operation:'yonetici_2_tur_eslestirme',createdAt:firebase.database.ServerValue.TIMESTAMP});
      const result=await db.ref(FIKSTUR_ISTISNA_YOLU).transaction(cur=>{
        if(!cur||!cur.juries||!cur.topics||cur.updatedAt!==current.updatedAt)return;
        if(cur.winners?.[35]&&cur.winners[35]!==school)return;
        if(cur.finalizedMatches?.[35])return;
        if(Object.keys(cur.winners||{}).some(x=>Number(x)>=41&&Number(x)<=53)||
           Object.keys(cur.finalizedMatches||{}).some(x=>Number(x)>=41&&Number(x)<=53)||
           ['orta_r3','orta_r4','orta_sf'].some(x=>!!cur.bayDraws?.[x]))return;
        cur.winners=cur.winners||{};cur.winnerSources=cur.winnerSources||{};
        cur.bayDraws=cur.bayDraws||{};cur.roundPairings=cur.roundPairings||{};
        cur.winners[35]=school;
        cur.winnerSources[35]={source:'yonetici_2_tur_eslestirme',updatedAt:Date.now(),reason};
        cur.bayDraws.orta_r2=byeTeam;
        cur.roundPairings.orta_r2={school,opponent,opponentMatchNo:opponentNo,byeTeam,reason,updatedAt:Date.now()};
        cur.updatedAt=Date.now();cur.sonIslem='yonetici_2_tur_eslestirme';
        return cur;
      },undefined,false);
      if(!result.committed)throw new Error('Fikstür başka cihazda değişti veya üst tur sonucu oluştu. Mevcut kayıtlar korunarak işlem durduruldu.');
      try{await auditRef.update({status:'uygulandi',updatedAt:firebase.database.ServerValue.TIMESTAMP});}catch(e){console.warn('İşlem günlüğü güncellenemedi:',e);}
      alert(school+', 2. turda '+opponent+' ile eşleştirildi. '+byeTeam+' ise diğer BAY hakkını aldı.');
      await renderFiksturIstisnaYonetimi();
    }

    async function fiksturIstisnayiKaydet(){
      if(!adminYetkiliMi()||!firebaseBagli||!navigator.onLine)return alert('Çevrimiçi yönetici yetkisi gerekli.');
      const op=document.getElementById('fIstTur')?.value;
      const no=Number(document.getElementById('fIstMac')?.value);
      const m=fiksturIstisnaListe.find(x=>x.no===no);
      if(op==='pair'){
        if(!m||no!==35)return alert('Bu işlem yalnızca rakipsiz #35 için kullanılabilir.');
        const opponentNo=document.getElementById('fIstR2Rakip')?.value;
        const byeNo=document.getElementById('fIstR2Bay')?.value;
        const reason=puanMetniNormalize(document.getElementById('fIstGerekce')?.value);
        if(!opponentNo||!byeNo)return alert('2. tur rakibini ve BAY alacak okulu ayrı ayrı seçin.');
        try{await fiksturRakipsizOkuluUstTurdaEslestir(m,opponentNo,byeNo,reason);}
        catch(err){alert('2. tur eşleşmesi yapılamadı: '+(err?.message||err));}
        return;
      }
      if(!m||m.isBay||m.roundTitle!=='1. Eleme Turu'||(op==='add'&&!m.isPending&&!m.isEmpty)||no<1||no>35)return alert('Geçerli ilk tur maçı seçin. #35 rakip beklerken doldurulabilir.');
      const kat=m.cat==='lise'?'LİSE':'ORTAOKUL';
      const team1=op==='move'?m.team1:puanMetniNormalize(document.getElementById('fIstHuk')?.value);
      const team2=op==='move'?m.team2:puanMetniNormalize(document.getElementById('fIstMuh')?.value);
      const date=op==='replace'?m.dateISO:document.getElementById('fIstTarih')?.value;
      const time=op==='replace'?m.time:document.getElementById('fIstSeans')?.value;
      const reason=puanMetniNormalize(document.getElementById('fIstGerekce')?.value);
      // Düzenlenmiş maçta tek BOŞ taraf mümkündür: bu bir BAY değildir, rakip bekleyen rezerve maçtır.
      const realSchool=x=>!!x&&!['boş','bay'].includes(fiksturIstisnaNorm(x));
      const distinct=!(realSchool(team1)&&realSchool(team2)&&fiksturIstisnaNorm(team1)===fiksturIstisnaNorm(team2));
      if(!distinct||(!realSchool(team1)&&!realSchool(team2))||[team1,team2].some(x=>fiksturIstisnaNorm(x)==='bay'))
        return alert('En az bir gerçek okul olmalı; iki okul varsa farklı olmalıdır. BOŞ taraf rakip bekleme anlamına gelir.');
      if(op==='add'&&(!realSchool(team1)||!realSchool(team2)))return alert('35. maçın rakibini tamamlamak için iki okulun da adı gereklidir.');
      const yeniTakim1=realSchool(team1)?team1:'BOŞ', yeniTakim2=realSchool(team2)?team2:'BOŞ';
      if(reason.length<12)return alert('Değişiklik gerekçesini en az 12 karakterle girin.');
      if(!/^20\d\d-\d\d-\d\d$/.test(date)||!FIKSTUR_ISTISNA_SEANSLAR.includes(time))return alert('Geçerli tarih ve seans seçin.');
      const selectedDate=new Date(date+'T12:00:00');
      if(Number.isNaN(selectedDate.getTime())||selectedDate.getDay()===0||selectedDate.getDay()===6)return alert('Maç tarihi hafta sonuna denk gelemez.');
      const dt2=selectedDate.getFullYear()+'-'+String(selectedDate.getMonth()+1).padStart(2,'0')+'-'+String(selectedDate.getDate()).padStart(2,'0');
      if(dt2!==date||date<'2026-10-19')return alert('Geçersiz tarih.');
      // Aynı salonda aynı tarih/saate iki gerçek maç planlanamaz.
      if(fiksturIstisnaTumMaclar.some(x=>x.no!==no&&!x.isEmpty&&!x.isBay&&x.dateISO===date&&x.time===time))return alert('Bu tarih/saat başka bir maç tarafından kullanılıyor. Boş seans seçin.');
      const sameTeams=fiksturIstisnaListe.filter(x=>x.no!==no&&!x.isEmpty&&x.cat===m.cat&&[x.team1,x.team2].filter(realSchool).some(n=>[yeniTakim1,yeniTakim2].filter(realSchool).some(z=>fiksturIstisnaNorm(n)===fiksturIstisnaNorm(z))));
      if(sameTeams.length)return alert('Seçtiğiniz okul başka bir ilk tur maçında görünüyor: '+sameTeams.map(x=>'#'+x.no).join(', '));
      if(op==='add'&&m.no!==35)return alert('Yalnızca resmî #35 boş maçına okul eklenebilir.');
      if(op!=='move'&&yeniTakim1===m.team1&&yeniTakim2===m.team2)return alert('Okul değişikliği yapılmadı.');
      if(op==='move'&&date===m.dateISO&&time===m.time)return alert('Yeni tarih/saat eskisiyle aynı.');
      const oldId=macKimligiOlustur(kat,m.team1,m.team2);
      const pSnap=await db.ref('puanlar/'+kat).once('value');
      let hasScore=false; pSnap.forEach(c=>{if(kayitMacId(c.val())===oldId)hasScore=true;});
      const pRef=db.ref(`maclar/${kat}/${oldId}`);
      const oldMatch=(await pRef.once('value')).val();
      const fRef=db.ref(FIKSTUR_ISTISNA_YOLU);
      const current=(await fRef.once('value')).val();
      if(hasScore||['kapali','iptal'].includes(oldMatch?.durum)||oldMatch?.sonuc?.kazanan||current?.winners?.[no]||current?.finalizedMatches?.[no])return alert('Bu maçın puanı, sonucu veya galibi var. Mevcut kayıtları korumak için değişiklik engellendi.');
      const once35Gercek=no===35&&realSchool(m.team1)&&realSchool(m.team2);
      const yeni35Gercek=no===35&&realSchool(yeniTakim1)&&realSchool(yeniTakim2);
      if(no===35 && once35Gercek!==yeni35Gercek){
        // #35 ikinci okulu eklendiğinde 24 maçtan 25 maça geçilir; sonuçlar girildiyse bu değişemez.
        const sonrakiTurKaydi=Object.keys(current?.winners||{}).some(x=>Number(x)>=41) ||
          Object.keys(current?.finalizedMatches||{}).some(x=>Number(x)>=41) ||
          ['orta_r2','orta_r3','orta_r4','orta_sf'].some(x=>!!current?.bayDraws?.[x]);
        if(sonrakiTurKaydi)return alert('İkinci tur sonuçları/BAY kuraları bulunduğundan #35 artık doldurulamaz. Eleme ağacı korunuyor.');
      }
      // Boş #35 daha önce ku    async function fiksturRakipsizOkuluUstTurdaEslestir(m,opponentMatchNo,byeMatchNo,reason){
      if(!adminYetkiliMi()||!firebaseBagli||!navigator.onLine)throw new Error('Çevrimiçi yönetici yetkisi gerekli.');
      if(!m||Number(m.no)!==35||m.cat!=='ortaokul'||!m.isPending)throw new Error('Bu işlem yalnızca rakibi belirlenmemiş ortaokul #35 için kullanılabilir.');
      const realSchool=x=>!!x&&!['boş','bay'].includes(fiksturIstisnaNorm(x));
      const school=[m.team1,m.team2].find(realSchool);
      if(!school)throw new Error('35. maçta gerçek okul bulunamadı.');
      if(reason.length<12)throw new Error('Gerekçe en az 12 karakter olmalıdır.');
      const opponentNo=Number(opponentMatchNo),byeNo=Number(byeMatchNo);
      if(!Number.isInteger(opponentNo)||opponentNo<11||opponentNo>34)throw new Error('Geçerli bir rakip maç galibi seçiniz.');
      if(!Number.isInteger(byeNo)||byeNo<11||byeNo>34||byeNo===opponentNo)throw new Error('Rakipten farklı, geçerli bir BAY alacak okul seçiniz.');
      const macId=macKimligiOlustur('ORTAOKUL',m.team1,m.team2);
      const [currentSnap,scoreSnap,matchSnap]=await Promise.all([
        db.ref(FIKSTUR_ISTISNA_YOLU).once('value'),
        db.ref('puanlar/ORTAOKUL').once('value'),
        db.ref('maclar/ORTAOKUL/'+macId).once('value')
      ]);
      const current=currentSnap.val();
      if(!current||!current.juries||!current.topics)throw new Error('Merkezî fikstür yüklenemedi.');
      let scored=false;scoreSnap.forEach(c=>{if(kayitMacId(c.val())===macId)scored=true;});
      if(scored||matchSnap.val()?.sonuc)throw new Error('35. maçta puan veya sonuç kaydı var. Puanlı karşılaşma yeniden eşleştirilemez.');
      if(current.winners?.[35]&&current.winners[35]!==school)throw new Error('35. maçta farklı bir galip kayıtlı.');
      if(current.finalizedMatches?.[35])throw new Error('35. maçta kesinleşmiş sonuç kaydı var.');
      if(current.bayDraws?.orta_r2||current.roundPairings?.orta_r2)
        throw new Error('2. tur eşleşmesi/BAY ataması daha önce kaydedilmiş. Mevcut atamanın üzerine yazılmadı.');
      const winners=current.winners||{};
      const firstRoundWinners=Array.from({length:24},(_,i)=>({no:11+i,school:winners[11+i]}));
      if(firstRoundWinners.some(x=>!x.school))throw new Error('Önce ortaokul 1. turdaki 24 maçın tamamının galibi kesinleşmeli.');
      const opponent=firstRoundWinners.find(x=>x.no===opponentNo)?.school;
      const byeTeam=firstRoundWinners.find(x=>x.no===byeNo)?.school;
      if(!opponent||!byeTeam)throw new Error('Seçilen rakip veya BAY alacak takım artık mevcut değil; listeyi yenileyin.');
      if(fiksturIstisnaNorm(opponent)===fiksturIstisnaNorm(school)||fiksturIstisnaNorm(byeTeam)===fiksturIstisnaNorm(school))
        throw new Error('Rakipsiz okul kendisiyle eşleştirilemez veya kendisine BAY verilemez.');
      if(fiksturIstisnaNorm(byeTeam)===fiksturIstisnaNorm(opponent))
        throw new Error('Bir okul aynı turda hem rakip hem BAY alacak takım olamaz.');
      const previousBays=Object.entries(current.bayDraws||{}).filter(([k])=>k!=='orta_r2').map(([,v])=>fiksturIstisnaNorm(v));
      if(previousBays.includes(fiksturIstisnaNorm(opponent)))
        throw new Error('Seçilen rakip daha önce BAY kullanmış; sonraki turda rakibi olmalı.');
      if(previousBays.includes(fiksturIstisnaNorm(byeTeam)))
        throw new Error('Seçilen BAY takımı daha önce BAY kullanmış; başka bir okul seçin.');
      const later=Object.keys(winners).some(x=>Number(x)>=41&&Number(x)<=53)||
        Object.keys(current.finalizedMatches||{}).some(x=>Number(x)>=41&&Number(x)<=53)||
        ['orta_r3','orta_r4','orta_sf'].some(x=>!!current.bayDraws?.[x]);
      if(later)throw new Error('Ortaokul 2. tur veya sonraki turlarda sonuç/BAY kaydı var. Fikstür güvenliği için eşleşme değiştirilemez.');
      const display='#35 · '+school+'\n2. tur rakibi: #'+opponentNo+' galibi · '+opponent+
        '\n2. tur BAY alacak okul: #'+byeNo+' galibi · '+byeTeam+
        '\nGerekçe: '+reason+'\n\nRakip ve BAY ataması yönetici seçimiyle kaydedilecek; rastgele BAY yapılmayacak.';
      if(!confirm('2. TUR EŞLEŞMESİ VE BAY ATAMASINI ONAYLA\n\n'+display+'\nDevam edilsin mi?'))return;
      const auditRef=db.ref('arsiv/fiksturDegisiklikleri/'+Date.now()+'_35_pair');
      await auditRef.set({before:current,school,opponent,opponentMatchNo:opponentNo,byeTeam,byeMatchNo:byeNo,reason,operation:'yonetici_2_tur_eslestirme',createdAt:firebase.database.ServerValue.TIMESTAMP});
      const result=await db.ref(FIKSTUR_ISTISNA_YOLU).transaction(cur=>{
        if(!cur||!cur.juries||!cur.topics||cur.updatedAt!==current.updatedAt)return;
        if(cur.winners?.[35]&&cur.winners[35]!==school)return;
        if(cur.finalizedMatches?.[35]||cur.bayDraws?.orta_r2||cur.roundPairings?.orta_r2)return;
        if(Object.keys(cur.winners||{}).some(x=>Number(x)>=41&&Number(x)<=53)||
           Object.keys(cur.finalizedMatches||{}).some(x=>Number(x)>=41&&Number(x)<=53)||
           ['orta_r3','orta_r4','orta_sf'].some(x=>!!cur.bayDraws?.[x]))return;
        cur.winners=cur.winners||{};cur.winnerSources=cur.winnerSources||{};
        cur.bayDraws=cur.bayDraws||{};cur.roundPairings=cur.roundPairings||{};
        cur.winners[35]=school;
        cur.winnerSources[35]={source:'yonetici_2_tur_eslestirme',updatedAt:Date.now(),reason};
        cur.bayDraws.orta_r2=byeTeam;
        cur.roundPairings.orta_r2={school,opponent,opponentMatchNo:opponentNo,byeTeam,byeMatchNo:byeNo,reason,updatedAt:Date.now()};
        cur.updatedAt=Date.now();cur.sonIslem='yonetici_2_tur_eslestirme';
        return cur;
      },undefined,false);
      if(!result.committed)throw new Error('Fikstür başka cihazda değişti veya üst tur sonucu oluştu. Mevcut kayıtlar korunarak işlem durduruldu.');
      try{await auditRef.update({status:'uygulandi',updatedAt:firebase.database.ServerValue.TIMESTAMP});}catch(e){console.warn('İşlem günlüğü güncellenemedi:',e);}
      alert(school+', 2. turda '+opponent+' ile eşleştirildi. '+byeTeam+' ise yönetici tarafından BAY atandı.');
      await renderFiksturIstisnaYonetimi();
    }

="katSec(this,'LİSE','turnuva')">LİSE AĞACI</button></div>
                <div style="margin-bottom:15px;font-size:14px;color:var(--text-muted);">Turnuva ağacı artık Firebase'de tutulur; aynı yönetici ekranı farklı cihazlarda aynı durumu görür. Değişiklikler transaction ile çakışmaya karşı korunur.</div>
                <textarea id="takimlar" style="height:100px;" placeholder="Sistemde kayıtlı okul aranıyor..." readonly></textarea>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"><button class="btn" style="background:var(--primary);border:none;" onclick="ilkTuruKur()">🎲 Turnuvayı Başlat / Yeniden Kur</button><button class="btn" style="background:#ef4444;border:none;" onclick="turnuvayiSifirla()">Turnuvayı Sıfırla</button></div>
                <div id="turnuvaRevision" style="font-size:11px;color:var(--text-muted);margin:8px 0;"></div>
                 <div id="fiksturKesinSonuclar" class="kriter-card"><b>Resmî Fikstürden Gelen Kesin Sonuçlar</b><div id="fiksturSonucSatirlari" style="margin-top:8px;">Henüz sonuç bulunmuyor.</div></div>
                <div id="sampiyonAlani"></div><div id="aktif-tur-container"></div><button class="btn" id="nextTurBtn" style="display:none;background:var(--success);border:none;margin-top:25px;padding:16px;" onclick="yeniTur()">Kalanlarla Üst Turu Kur</button><div id="gecmis-turlar"></div>
                <button class="btn" style="background:#475569" onclick="anaMenu()">← Ana Menü</button>
            </div>`;
        db.ref('okullar/'+secimler.kategori).once('value',s=>{const arr=[];s.forEach(o=>arr.push(o.key));const ta=document.getElementById('takimlar');if(ta)ta.value=arr.join('\n');});
        aktifTurnuvaRef=turnuvaRef();
        aktifTurnuvaRef.on('value',s=>{const state=s.val();if(state)localStorage.setItem(TURN_CACHE_PREFIX+secimler.kategori,JSON.stringify(state));renderTurnuvaState(state);},err=>{console.error(err);try{renderTurnuvaState(JSON.parse(localStorage.getItem(TURN_CACHE_PREFIX+secimler.kategori)||'null'));}catch(_){}});
    }

    function renderTurnuvaState(state){
        const kutu=document.getElementById('fiksturSonucSatirlari');
        if(kutu){
            const sonuclar=Object.values(state?.fiksturSonuclari || {}).sort((a,b)=>Number(a.macNo)-Number(b.macNo));
            kutu.innerHTML=sonuclar.length ? sonuclar.map(x=>`<div style="padding:7px 0;border-bottom:1px solid #334155;"><b>#${Number(x.macNo)} · ${htmlEscape(x.okul1)} / ${htmlEscape(x.okul2)}</b> — ${Number(x.puan1)} : ${Number(x.puan2)} · <span style="color:#34d399">${htmlEscape(x.galip)}</span> (${x.yontem==='sure'?'kısa süre':x.yontem==='son_savunma'?'son savunma':'puan'})</div>`).join('') : 'Henüz kesinleşmiş resmî fikstür sonucu yok.';
        }
        const rev=document.getElementById('turnuvaRevision'),act=document.getElementById('aktif-tur-container'),old=document.getElementById('gecmis-turlar'),champ=document.getElementById('sampiyonAlani'),next=document.getElementById('nextTurBtn');if(!act||!old||!champ||!next)return;if(!state?.rounds){act.innerHTML='<div class="kriter-card" style="text-align:center;color:var(--text-muted);">Ayrı Canlı Puan Ağacı kurulmamış. Resmî fikstürden kesinleşen sonuçlar yukarıda gösteriliyor.</div>';old.innerHTML='';champ.innerHTML='';next.style.display='none';if(rev)rev.textContent='';return;}if(rev)rev.textContent=`Revizyon: ${state.revision||0} · Son güncelleme: ${state.updatedAt?new Date(state.updatedAt).toLocaleString('tr-TR'):'-'}`;const cr=Number(state.currentRound||1);const r=state.rounds?.['r'+cr];act.innerHTML=`<h3 style="color:var(--text-main);font-size:20px;border-left:4px solid var(--accent);padding-left:8px;">Aktif Tur: ${cr}. Eleme Eşleşmeleri</h3>`;const winners=[];Object.entries(r?.matches||{}).forEach(([mk,m])=>{if(m.winner)winners.push(m.winner);if(m.team2==='BYE'){act.innerHTML += `<div class="match-box" style="border-color:var(--success);"><b style="color:var(--success);">${htmlEscape(m.team1)}</b><br><span style="color:var(--text-muted);font-size:12px;">vs</span><br><b>BYE</b><div class="win-tag">Otomatik Tur Atladı</div></div>`;return;}const status=m.winner?`<div class="win-tag">Kazanan: ${htmlEscape(m.winner)}</div>`:(m.provisionalWinner?`<div class="win-tag" style="background:#78350f;color:#fde68a;border-color:#92400e;">Geçici üstün: ${htmlEscape(m.provisionalWinner)} · Maçı kapatınca kesinleşir</div>`:'');act.innerHTML += `<div class="match-box"><div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;">${htmlEscape(m.macId)}</div><div class="match-team" style="border-bottom:1px solid #1f2937;padding-bottom:6px;"><span><b>${htmlEscape(m.team1)}</b></span><input type="number" class="skor-input" id="ts-${cr}-${mk}-1" value="${m.score1??''}" onchange="turnuvaManuelSkorKaydet('${'r'+cr}','${mk}')"></div><div style="text-align:center;margin:4px 0;font-size:11px;color:var(--text-muted);font-weight:bold;letter-spacing:1px;">VS</div><div class="match-team" style="border-top:1px solid #1f2937;padding-top:6px;"><span><b>${htmlEscape(m.team2)}</b></span><input type="number" class="skor-input" id="ts-${cr}-${mk}-2" value="${m.score2??''}" onchange="turnuvaManuelSkorKaydet('${'r'+cr}','${mk}')"></div>${status}</div>`;});
        const matchCount=Object.keys(r?.matches||{}).length;const tamam=matchCount>0&&Object.values(r.matches).every(m=>!!m.winner);if(state.champion){champ.innerHTML=`<div class="champ-card">🏆 ${htmlEscape(secimler.kategori)} ŞAMPİYONU: ${htmlEscape(state.champion)} 🏆</div>`;next.style.display='none';}else{champ.innerHTML='';next.style.display=tamam?'block':'none';}
        old.innerHTML='';for(let n=cr-1;n>=1;n--){const rr=state.rounds?.['r'+n];if(!rr)continue;let h=`<div class="old-tur"><h4 style="color:var(--text-muted);margin-bottom:10px;">${n}. Tur Sonuç Arşivi</h4>`;Object.values(rr.matches||{}).forEach(m=>{h += `<div class="match-box" style="opacity:.75;"><div>${htmlEscape(m.team1)} <span style="color:var(--accent);">(${m.score1??'-'})</span></div><div>${htmlEscape(m.team2)} <span style="color:var(--accent);">(${m.score2??'-'})</span></div><div style="font-size:11px;color:var(--success);margin-top:5px;font-weight:bold;">→ ${htmlEscape(m.winner||'Sonuç yok')}</div></div>`;});old.innerHTML += h+'</div>';}
    }

    async function ilkTuruKur(){const ta=document.getElementById('takimlar');let t=(ta?.value||'').split('\n').map(x=>x.trim()).filter(Boolean);if(t.length<2)return alert('Turnuvayı başlatmak için en az 2 okul bulunmalıdır!');const current=await turnuvaRef().once('value');if(current.exists()&&!confirm('Mevcut merkezi turnuva ağacı var. Yeni turnuva kurarsanız mevcut ağaç arşivlenip yenisi oluşturulacak. Devam edilsin mi?'))return;if(current.exists())await db.ref(`arsiv/turnuva/${secimler.kategori}/${Date.now()}`).set(current.val());t=t.map(x=>({x,r:Math.random()})).sort((a,b)=>a.r-b.r).map(o=>o.x);const round=roundOlustur(secimler.kategori,1,t);const state={version:3,revision:(current.val()?.revision||0)+1,status:'active',currentRound:1,rounds:{r1:round},champion:'',teams:t,fiksturSonuclari:current.val()?.fiksturSonuclari||{},createdAt:Date.now(),updatedAt:Date.now()};await turnuvaRef().set(state);await roundMaclariniKaydet(secimler.kategori,round);firebaseArsivYedegiAl(true,'turnuva_baslangic');}

    async function turnuvaManuelSkorKaydet(roundKey,matchKey){const stateSnap=await turnuvaRef().once('value');const cur=stateSnap.val();const turNo=Number(roundKey.replace('r',''));const s1=parseFloat(document.getElementById(`ts-${turNo}-${matchKey}-1`)?.value),s2=parseFloat(document.getElementById(`ts-${turNo}-${matchKey}-2`)?.value);await turnuvaRef().transaction(state=>{if(!state?.rounds?.[roundKey]?.matches?.[matchKey])return state;const m=state.rounds[roundKey].matches[matchKey];m.score1=Number.isFinite(s1)?s1:null;m.score2=Number.isFinite(s2)?s2:null;m.provisionalWinner='';m.winner='';if(Number.isFinite(s1)&&Number.isFinite(s2)){if(s1>s2)m.winner=m.team1;else if(s2>s1)m.winner=m.team2;}m.updatedAt=Date.now();state.revision=(state.revision||0)+1;state.updatedAt=Date.now();return state;});}

    async function turnuvaAgacinaPuanYansit(kat,hukOkul,muhOkul,forceFinalize=false) {
        if(!hukOkul||!muhOkul)return;
        const id=macKimligiOlustur(kat,hukOkul,muhOkul);
        const [s,mSnap]=await Promise.all([db.ref('puanlar/'+kat).once('value'),db.ref(`maclar/${kat}/${id}`).once('value')]);
        const mc=mSnap.val() || {};
        let tHuk=0,tMuh=0;
        snapshotKayitlariniTekillestir(s).forEach(v=>{
            if(kayitMacId(v)!==id)return;
            const t=puanToplami(v);
            if(v.secim?.okul===hukOkul)tHuk+=t;
            if(v.secim?.okul===muhOkul)tMuh+=t;
        });
        const finalized=mc.durum==='kapali' && mc.sonuc?.kazanan && mc.sonuc?.senkronDurum==='tamam';
        await turnuvaRef(kat).transaction(state=>{
            if(!state?.rounds)return;
            let changed=false;
            for(const rr of Object.values(state.rounds))for(const m of Object.values(rr.matches||{})){
                if(m.team2==='BYE' || !okulCiftiEslesiyor(m.team1,m.team2,hukOkul,muhOkul))continue;
                // Kesinleşmiş resmî sonuç ham/şüpheli jüri kayıtlarıyla ezilmez.
                const resmiH=mc.sonuc?.puanHuk, resmiM=mc.sonuc?.puanMuh;
                const resmiPuanVar=finalized&&Number.isFinite(resmiH)&&Number.isFinite(resmiM);
                const hk=resmiPuanVar?resmiH:tHuk, mh=resmiPuanVar?resmiM:tMuh;
                m.score1=skorEslesmeAnahtari(m.team1)===skorEslesmeAnahtari(hukOkul)?hk:mh;
                m.score2=skorEslesmeAnahtari(m.team2)===skorEslesmeAnahtari(muhOkul)?mh:hk;
                m.provisionalWinner=finalized?mc.sonuc.kazanan:hk>mh?hukOkul:(mh>hk?muhOkul:'');
                if(finalized)m.winner=mc.sonuc.kazanan;
                m.updatedAt=Date.now();changed=true;
            }
            if(!changed)return;
            state.revision=(state.revision||0)+1;state.updatedAt=Date.now();return state;
        },undefined,false);
    }

    async function yeniTur(){let olusanRound=null;await turnuvaRef().transaction(state=>{if(!state?.rounds)return state;const cr=Number(state.currentRound||1),r=state.rounds['r'+cr];if(!r)return state;const matches=Object.values(r.matches||{});if(!matches.length||!matches.every(m=>!!m.winner))return state;const winners=matches.map(m=>m.winner);if(winners.length===1){state.champion=winners[0];state.status='completed';state.revision=(state.revision||0)+1;state.updatedAt=Date.now();return state;}const nextNo=cr+1;if(state.rounds['r'+nextNo])return state;olusanRound=roundOlustur(secimler.kategori,nextNo,winners);state.rounds['r'+nextNo]=olusanRound;state.currentRound=nextNo;state.revision=(state.revision||0)+1;state.updatedAt=Date.now();return state;});if(olusanRound)await roundMaclariniKaydet(secimler.kategori,olusanRound);await firebaseArsivYedegiAl(true,'tur_gecisi');}

    async function turnuvayiSifirla(){const cevap=prompt(`${secimler.kategori} turnuvasını merkezi veritabanından sıfırlamak için SIFIRLA yazınız:`);if(cevap!=='SIFIRLA')return;const snap=await turnuvaRef().once('value');if(snap.exists())await db.ref(`arsiv/turnuva/${secimler.kategori}/${Date.now()}`).set(snap.val());await turnuvaRef().remove();localStorage.removeItem(TURN_CACHE_PREFIX+secimler.kategori);alert('Turnuva ağacı arşivlendi ve sıfırlandı. Puan kayıtları silinmedi.');}

    // Geriye dönük çağrılar için: artık Firebase cache'i kullanılır.
    function hafizayaKaydet(dataObj){localStorage.setItem(TURN_CACHE_PREFIX+secimler.kategori,JSON.stringify(dataObj));}
    function turKur(){/* V3'te roundOlustur + Firebase state kullanılır. */}
    function otomatikSkorKontrol(){/* V3'te turnuvaManuelSkorKaydet kullanılır. */}
    function kontrolEtVeButonGoster(){/* V3'te renderTurnuvaState hesaplar. */}

    // Kesinleşmiş sonuç tüm bağlı jüri cihazlarında birer kez görünür.
    // Tek kaynak, mevcut Firebase maç kaydı. Bir cihaz aynı kapanışı ikinci kez görmez.
    const SONUC_GORULDU_KEY='munazaraSonucDuyuruGorulduV1';
    const sonucDuyuruKuyrugu=[];
    let sonucDuyuruAcik=false;
    function sonucDuyuruKapat(){
        document.getElementById('ortakSonucDuyuru')?.remove();
        sonucDuyuruAcik=false;
        if(sonucDuyuruKuyrugu.length)sonucDuyuruGoster();
    }
    function sonucDuyuruGoster(){
        if(sonucDuyuruAcik || !sonucDuyuruKuyrugu.length)return;
        if(!juriOturumuGetir())return; // Yönetici ekranlarını kesintiye uğratma.
        const x=sonucDuyuruKuyrugu.shift();
        sonucDuyuruAcik=true;
        const host=document.createElement('div');host.id='ortakSonucDuyuru';
        host.className='sure-modal-bg';host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');
        host.innerHTML=`<div class="sure-modal-card" style="max-width:570px;text-align:center;border:2px solid #10b981">
            <div style="color:#34d399;font-size:12px;font-weight:bold">🏆 RESMÎ MAÇ SONUCU</div>
            <h2 style="font-size:21px;margin-top:12px">${htmlEscape(x.etiket)}</h2>
            <div style="font-size:23px;color:#facc15;font-weight:800;line-height:1.5">${htmlEscape(x.kazanan||'Her iki okul elendi')}</div>
            ${x.puanHuk!=null&&x.puanMuh!=null?`<p>${htmlEscape(x.hukOkul)}: <b>${x.puanHuk}</b> — ${htmlEscape(x.muhOkul)}: <b>${x.puanMuh}</b></p>`:''}
            <p class="sure-hint">Maç kesinleşti. Bu bildirim aynı jüri cihazında yalnız bir kez gösterilir.</p>
            <button class="btn" style="background:#0f766e" onclick="sonucDuyuruKapat()">✓ Sonucu Gördüm</button></div>`;
        document.body.appendChild(host);
    }
    function sonucDuyuruKaydet(seen,kat,macId,stamp,result){
        const key=`${kat}|${macId}|${stamp}`;
        if(seen[key])return false;
        const already=Object.keys(seen).some(x=>{
            const parts=x.split('|');
            return parts[0]===kat && parts[1]===String(macId) && Math.abs(Number(parts[2])-stamp)<=30000;
        });
        seen[key]=true;
        if(!already && Date.now()-stamp<60*60*1000 && Date.now()>=stamp-60000)
            sonucDuyuruKuyrugu.push(result);
        return true;
    }
    function sonucDuyurulariniDinle(){
        for(const kat of ['ORTAOKUL','LİSE']){
            db.ref(`maclar/${kat}`).on('value',snap=>{
                let seen={};try{seen=JSON.parse(localStorage.getItem(SONUC_GORULDU_KEY)||'{}')||{};}catch(_){}
                const now=Date.now();let degisti=false;
                snap.forEach(c=>{
                    const m=c.val();const s=m?.sonuc;
                    if(m?.durum!=='kapali'||!s||(!s.kazanan&&s.yontem!=='cift_eleme'))return;
                    const stamp=Number(m.closedAt||s.createdAt||0);
                    if(!stamp)return;
                    if(sonucDuyuruKaydet(seen,kat,c.key,stamp,{
                        etiket:m.etiket||macEtiketi(m.hukOkul,m.muhOkul),
                        kazanan:s.kazanan,puanHuk:s.puanHuk,puanMuh:s.puanMuh,
                        hukOkul:m.hukOkul,muhOkul:m.muhOkul}))degisti=true;
                });
                if(degisti)localStorage.setItem(SONUC_GORULDU_KEY,JSON.stringify(seen));
                sonucDuyuruGoster();
            },e=>console.warn('Jüri sonuç duyurusu:',e));
        }
        // Ayrıca resmî fikstürden kesinleşen fakat operasyon kaydı açık kalan
        // tarihî maçlar: yeni sonuçlar jüri ekranına yine yalnız bir kez gelir.
        db.ref('fikstur/tekSalon_2026_2027/finalizedMatches').on('value',snap=>{
            let seen={};try{seen=JSON.parse(localStorage.getItem(SONUC_GORULDU_KEY)||'{}')||{};}catch(_){}
            let degisti=false;
            snap.forEach(c=>{
                const v=c.val();if(!v||(!v.kazanan&&v.yontem!=='cift_eleme'))return;
                const kat=v.kategori||secimler.kategori;
                const stamp=Number(v.closedAt||v.createdAt||0);
                if(!stamp)return;
                const macId=v.macId||('resmi_'+c.key);
                if(sonucDuyuruKaydet(seen,kat,macId,stamp,{
                    etiket:`#${c.key} · Resmî fikstür sonucu`,kazanan:v.kazanan,
                    puanHuk:v.puanHuk,puanMuh:v.puanMuh,
                    hukOkul:'Hükümet',muhOkul:'Muhalefet'}))degisti=true;
            });
            if(degisti)localStorage.setItem(SONUC_GORULDU_KEY,JSON.stringify(seen));
            sonucDuyuruGoster();
        },e=>console.warn('Resmî fikstür sonucu duyurusu:',e));
    }
    function ekranGeriDon(){
        if(document.getElementById('ortakSonucDuyuru'))return sonucDuyuruKapat();
        if(document.getElementById('yoneticiManuelSonucHost'))return yoneticiManuelPencereKapat();
        if(document.querySelector('.sure-modal-bg'))return sureModalKapat();
        const app=document.getElementById('app');if(!app)return;
        if(document.getElementById('ortakKonusmaSayaci'))return renderPuanlamaSecim();
        if(document.getElementById('aktifMac'))return anaMenu();
        if(document.getElementById('sureHizliMacSec'))return window.sureEkraniGirisKaynak==='yonetici'?renderYoneticiCanliPanel():renderPuanlamaSecim();
        if(document.getElementById('liveMatches')||document.getElementById('gunFiltre')||
           document.getElementById('ogrenciListesi')||document.getElementById('turnuvaFiksturFrame')||
           app.querySelector('.fixture-shell'))return renderYoneticiMenu();
        const title=(app.querySelector('h1,h2')?.textContent||'').toLocaleLowerCase('tr-TR');
        if(title.includes('yönetici modülü'))return anaMenu();
        if(title.includes('ana ')||title.includes('münazara yönetim sistemi'))return anaMenu();
        if(adminYetkiliMi())return renderYoneticiMenu();
        return anaMenu();
    }
    function ustGezinmeyiGuncelle(){
        const app=document.getElementById('app');if(!app)return;
        let nav=document.getElementById('ustGezinme');
        if(!nav){
            nav=document.createElement('nav');nav.id='ustGezinme';nav.className='global-nav no-print';
            nav.setAttribute('aria-label','Ekran gezinme');
            nav.innerHTML='<button type="button" onclick="ekranGeriDon()" title="Geri dön (Backspace)">← Geri</button><button type="button" onclick="anaMenu()" title="Ana menüye git">⌂ Ana Menü</button>';
            document.body.appendChild(nav);
        }
        let bell=nav.querySelector('#adminGlobalNotificationButton');
        if(typeof adminYetkiliMi==='function'&&adminYetkiliMi()){
            if(!bell){
                bell=document.createElement('button');bell.id='adminGlobalNotificationButton';
                bell.type='button';bell.className='admin-global-notification';
                bell.onclick=()=>bildirimMerkeziniAc();
                bell.title='Puan gönderim bildirimleri ve bekleyen kayıtlar';
                nav.appendChild(bell);
            }
            const pending=typeof offlineKuyrukGetir==='function'
                ?Object.values(offlineKuyrukGetir()).filter(x=>x&&x.kayit).length:0;
            const unread=typeof puanBildirimOkunmamisSayisi==='function'?puanBildirimOkunmamisSayisi():0;
            const badge=pending||unread;
            bell.innerHTML='🔔 Bildirimler'+(badge?'<span class="admin-notification-count">'+badge+'</span>':'');
        }else if(bell)bell.remove();
        const anasayfa=!!app.querySelector('main.home-shell:not(.admin-menu-shell) .home-head');
        nav.style.display=anasayfa?'none':'flex';
    }
    document.addEventListener('keydown',event=>{
        if(event.key!=='Backspace'||event.repeat||event.altKey||event.ctrlKey||event.metaKey)return;
        const target=event.target;
        if(target?.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(target?.tagName))return;
        event.preventDefault();ekranGeriDon();
    });
    