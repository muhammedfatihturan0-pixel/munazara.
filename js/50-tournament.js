// --- FIREBASE MERKEZLİ TURNUVA AĞACI ---
    function turnuvaRef(kategori=secimler.kategori){return db.ref('turnuva/'+kategori);}

    function roundOlustur(kategori,turNo,takimlar){const matches={};for(let i=0;i<takimlar.length;i+=2){const t1=takimlar[i]||'BYE',t2=takimlar[i+1]||'BYE';const key='m'+(i/2);const bye=t2==='BYE';matches[key]={key,index:i,macId:bye?`bye_${turNo}_${i}_${hash32(t1)}`:macKimligiOlustur(kategori,t1,t2),team1:t1,team2:t2,score1:null,score2:null,winner:bye?t1:'',provisionalWinner:'',status:bye?'bye':'open',updatedAt:Date.now()};}return{turNo,createdAt:Date.now(),matches};}

    async function roundMaclariniKaydet(kategori,round){if(!round?.matches)return;for(const m of Object.values(round.matches)){if(m.team2==='BYE')continue;await ensureMatchExists(kategori,m.team1,m.team2);}}

    