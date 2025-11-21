// Die API-Datei, die für das Löschen eines Modells und der zugehörigen Dateien
// (Modelldaten, Textur, Metadaten) aus dem Vercel Blob Storage zuständig ist.
// Diese Datei muss im Ordner 'api/' deines Vercel-Projekts gespeichert werden.

import { del } from '@vercel/blob';

// Haupt-Handler-Funktion für die Serverless Function
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ message: 'Nur POST-Anfragen erlaubt.' });
        return;
    }

    try {
        // 1. Lese die Model-ID aus dem Request Body
        const { id: modelId } = req.body;

        if (!modelId) {
            return res.status(400).json({ message: 'Fehlende Modell-ID.' });
        }
        
        // 2. Erstelle ein Array mit allen zu löschenden Blob-URLs
        // Wir gehen davon aus, dass die Dateien im Format models/{modelId}/[filename] gespeichert sind.
        // Die genauen URLs sind:
        // - Metadaten: models/{modelId}/metadata.json
        // - Textur: models/{modelId}/texture.png
        // - Modell: models/{modelId}/model.* (Hier müssen wir vorsichtig sein und das Löschen basierend auf der ID durchführen, da die Dateiendung unbekannt ist)
        
        // Da wir die genaue Endung des Modells (.obj, .gltf, etc.) hier nicht kennen, 
        // löschen wir die Metadaten und Textur direkt. Für das Modell selbst müssten wir 
        // normalerweise zuerst die Metadaten laden, um die URL zu bekommen.
        
        // Der einfachste Weg im Kontext von Vercel Blob: Lösche den gesamten Ordner-Präfix.
        // Das Vercel SDK bietet derzeit keine einfache Funktion zum Löschen nach Präfix (Ordner).
        // Daher müssen wir die Dateien einzeln löschen.

        // WICHTIG: Im Upload-Skript (api/upload.js) haben wir die Metadaten so strukturiert, 
        // dass wir die URLs kennen: modelUrl und textureUrl. Wir MÜSSEN diese zuerst laden, 
        // um die genauen URLs für del() zu erhalten.
        
        const metadataUrl = `${req.headers.origin}/models/${modelId}/metadata.json`;
        let modelMetadata;
        
        try {
            // Lade Metadaten, um die genauen URLs des Modells und der Textur zu erhalten.
            const metaResponse = await fetch(metadataUrl);
            if (!metaResponse.ok) {
                // Wenn Metadaten nicht existieren, ist das Modell wahrscheinlich schon gelöscht oder nie existiert.
                return res.status(404).json({ message: 'Modell-Metadaten nicht gefunden (kann bereits gelöscht sein).' });
            }
            modelMetadata = await metaResponse.json();
        } catch (error) {
            console.error(`Fehler beim Laden der Metadaten für ID ${modelId}:`, error);
            return res.status(500).json({ message: 'Interner Serverfehler beim Abrufen der Metadaten.' });
        }
        
        // Definiere die zu löschenden URLs
        const urlsToDelete = [
            modelMetadata.modelUrl,
            modelMetadata.textureUrl,
            modelMetadata.thumbnailUrl || null, // Thumbnail-URL, falls vorhanden
            metadataUrl.replace(req.headers.origin + '/', 'https://pub-your-blob-store-id.r2.dev/'), // Metadata-URL (Muss eine Vercel Blob-URL sein)
            
            // Da die Metadaten-URL, die wir oben konstruiert haben, eine relative URL 
            // vom Frontend aus ist, müssen wir sie in die tatsächliche Blob-Speicher-URL 
            // umwandeln, die 'del' benötigt. Die genaue URL-Struktur ist:
            // https://pub-your-blob-store-id.r2.dev/models/{modelId}/metadata.json
            // Da wir die Blob-ID nicht kennen, müssen wir uns auf die im Upload-Skript 
            // gespeicherte URL verlassen. In diesem Fall machen wir es einfacher und 
            // löschen die einzelnen Pfade:
            
            `models/${modelId}/metadata.json`,
            `models/${modelId}/texture.png`,
            `models/${modelId}/model.${modelMetadata.modelType}`,
            `models/${modelId}/thumbnail.png`, // Optional, da die URL im JSON enthalten sein sollte
        ].filter(url => url && !url.startsWith(req.headers.origin)); // Filtere leere und relative URLs

        // Füge die URL für die Metadaten-Datei hinzu (da sie nicht im JSON selbst steht)
        // Wir müssen den Dateipfad relativ zum Root des Blobspeichers übergeben.
        const metadataPath = `models/${modelId}/metadata.json`;
        
        // 3. Führe den Löschvorgang für alle URLs durch
        await del([
            modelMetadata.modelUrl,
            modelMetadata.textureUrl,
            modelMetadata.thumbnailUrl, // Wenn bereits im JSON gespeichert
            metadataPath, // Die Metadaten-Datei selbst
        ].filter(url => url)); // Filtere alle null-Werte

        
        // 4. Sende erfolgreiche Antwort
        res.status(200).json({ 
            id: modelId, 
            message: 'Modell und zugehörige Assets erfolgreich gelöscht.' 
        });

    } catch (error) {
        console.error('SERVER FEHLER beim Löschen:', error);
        res.status(500).json({ message: `Interner Serverfehler beim Löschen des Modells: ${error.message}` });
    }
}