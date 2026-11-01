// --- BAŞLATMA ---
    window.addEventListener('online',()=>{networkDurumunuGuncelle();offlineKuyruguGonder();});
    window.addEventListener('offline',networkDurumunuGuncelle);
    db.ref('.info/connected').on('value',s=>{
        firebaseBagli=s.val()===true;
        networkDurumunuGuncelle();
        if(firebaseBagli){
            offlineKuyruguGonder();
            void juriSureAuditKuyrugunuGonder();
            void juriCihazDurumunuGuncelle(true);
        }
    });
    setInterval(()=>{
        offlineKuyruguGonder();
        void juriSureAuditKuyrugunuGonder();
        void juriCihazDurumunuGuncelle();
    },15000);

    window.onload=function(){
        const oturum=juriOturumuGetir();
        if(oturum){secimler.juri=oturum.juri;secimler.juriAd=oturum.ad;secimleriKaydet();}
        networkDurumunuGuncelle();
        anaMenu();
        // Yalnız ekran kökü değiştiğinde gezinme denetimini güncelle.
        const app=document.getElementById('app');
        new MutationObserver(ustGezinmeyiGuncelle).observe(app,{childList:true});
        ustGezinmeyiGuncelle();
        sonucDuyurulariniDinle();
    };
