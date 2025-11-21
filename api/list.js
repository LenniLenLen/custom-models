// Die API-Datei, die alle hochgeladenen Modell-Metadaten aus dem Vercel Blob Storage abruft.
// Diese Datei muss im Ordner 'api/' deines Vercel-Projekts gespeichert werden.

import { list, get } from '@vercel/blob';

// Haupt-Handler-Funktion für die Serverless Function
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.status(405).json({ message: 'Nur GET-Anfragen erlaubt.' });
        return;
    }

    try {
        // 1. Liste alle Dateien im 'models/' Präfix ab
        // Mit Vercel Blob erhalten wir maximal 1000 Dateien pro List-Aufruf, 
        // was für dieses Projekt ausreichend ist.
        const blobList = await list({ 
            prefix: 'models/', 
            limit: 1000 
        });

        // 2. Filtere nur nach den Metadaten-Dateien (metadata.json)
        const metadataFiles = blobList.blobs.filter(blob => 
            blob.pathname.endsWith('/metadata.json')
        );

        // 3. Lade den Inhalt jeder Metadaten-Datei asynchron herunter
        const fetchPromises = metadataFiles.map(async (file) => {
            try {
                // 'get' lädt den Inhalt der Datei
                const blob = await get(file.url, { type: 'json' }); 
                // Der Typ 'json' parst den Inhalt automatisch
                return blob; 
            } catch (error) {
                console.error(`Fehler beim Abrufen der Metadaten für ${file.pathname}:`, error);
                return null; // Ignoriere fehlerhafte Metadaten
            }
        });

        // 4. Warte auf alle Downloads und filtere fehlgeschlagene
        const models = (await Promise.all(fetchPromises)).filter(model => model !== null);

        // 5. Sortiere die Modelle nach dem neuesten zuerst
        models.sort((a, b) => b.timestamp - a.timestamp);

        // 6. Sende die Liste zurück
        res.status(200).json(models);

    } catch (error) {
        console.error('SERVER FEHLER beim Abrufen der Liste:', error);
        res.status(500).json({ message: `Interner Serverfehler beim Laden der Modelle: ${error.message}` });
    }
}