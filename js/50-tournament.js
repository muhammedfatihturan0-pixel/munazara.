// --- FIREBASE MERKEZLİ TURNUVA AĞACI ---
    function turnuvaRef(kategori=secimler.kategori){return db.ref('turnuva/'+kategori);}

    function roundOlustur(kategori,turNo,takimlar,bayAlanOkul=''){
        const teams=(takimlar||[]).map(x=>String(x||'').trim()).filter(Boolean);
        const odd=teams.length%2===1;
        const keyOf=x=>skorEslesmeAnahtari(x);
        if(odd&&(!bayAlanOkul||!teams.some(x=>keyOf(x)===keyOf(bayAlanOkul))))
            throw new Error('Takım sayısı tek. Üst tur kurulmadan önce yöneticinin BAY alacak okulu seçmesi gerekir.');
        if(!odd&&bayAlanOkul)throw new Error('Takım sayısı çift; bu tur için BAY ataması yapılamaz.');
        const paired=odd?teams.filter(x=>keyOf(x)!==keyOf(bayAlanOkul)):teams;
        const matches={};
        for(let i=0;i<paired.length;i+=2){
            const team1=paired[i],team2=paired[i+1];
            if(!team1||!team2)throw new Error('Eşleştirme için takım sayısı tutarsız. Turnuva ağacı oluşturulmadı.');
            const key='m'+(i/2);
            matches[key]={key,index:i,macId:macKimligiOlustur(kategori,team1,team2),
                team1,team2,score1:null,score2:null,winner:'',provisionalWinner:'',
                status:'open',updatedAt:Date.now()};
        }
        if(odd){
            const index=paired.length,key='m'+(index/2);
            matches[key]={key,index,macId:`bye_${turNo}_${index}_${hash32(bayAlanOkul)}`,
                team1:bayAlanOkul,team2:'BYE',score1:null,score2:null,winner:bayAlanOkul,
                provisionalWinner:'',status:'bye',byeAtama:'yonetici',updatedAt:Date.now()};
        }
        return{turNo,createdAt:Date.now(),matches};
    }

    async function roundMaclariniKaydet(kategori,round){if(!round?.matches)return;for(const m of Object.values(round.matches)){if(m.team2==='BYE')continue;await ensureMatchExists(kategori,m.team1,m.team2);}}

    