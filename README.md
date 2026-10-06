# Pre-Regata

App web installabile (PWA) per la preparazione della regata: vento multi-modello con scelta automatica dei modelli migliori per la zona, carta sinottica con lettura automatica, percorso con calcolo dei lati e delle vele, tattica scritta con AI.

## Pubblicazione su GitHub Pages (come Vela Gym)
1. Crei un nuovo repository, ad esempio `PreRegata`.
2. Carichi tutti i file di questa cartella nella radice del repository.
3. Settings → Pages → Source: branch `main`, cartella `/ (root)`.
4. Dopo un minuto l'app è su `https://<utente>.github.io/PreRegata/`. Dal telefono: "Aggiungi a schermata Home".

## Uso
- **Vento**: cerchi un luogo, scriva le coordinate o tocchi la mappa; scelga Lago / Costiero / Offshore. L'app scarica 18 modelli, scarta quelli che non coprono il punto e pesa gli altri per risoluzione, tipo di campo e anticipo.
- **Sinottica**: isobare ogni 4 hPa, alte e basse, vento al suolo, cursore temporale fino a +5 giorni; lettura automatica di barometro, centri vicini e vento di gradiente. Con "Analisi con AI" si possono aggiungere foto di carte ufficiali.
- **Percorso**: foto o PDF delle istruzioni di regata → punti estratti automaticamente (da verificare), oppure inserimento a mano. "Calcola lati e vele" stima orari, vento, angolo, vela e cambi vela per ogni lato.
- **Vele**: tabella di incrocio per barca (anche da foto). Valori d'esempio da sostituire.
- **Impostazioni**: chiave API Anthropic per le funzioni AI (salvata solo sul dispositivo).

Fonti: Open-Meteo (MeteoSwiss, ECMWF, DWD, Météo-France, ItaliaMeteo/ARPAE, KNMI, DMI, Met Office, NOAA, Environment Canada), Open-Meteo Marine, OpenStreetMap.
