// Die API-Datei, die für den multipart/form-data Upload und die Speicherung zuständig ist.
// Diese Datei muss im Ordner 'api/' deines Vercel-Projekts gespeichert werden.

import { IncomingForm } from 'formidable';
import { put } from '@vercel/blob';
import JSZip from 'jszip';

// Helper-Funktion, um das asynchrone Parsen von Formidable in einen Promise zu wickeln.
const parseForm = (req) => {
return new Promise((resolve, reject) => {
const form = new IncomingForm({
multiples: false,
// Begrenzt die Dateigröße (z.B. auf 100 MB), falls nötig
maxFileSize: 100 * 1024 * 1024,
});

    form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
    });
});


};

// Vercel erfordert, dass man body-parser deaktiviert, wenn man Formidable nutzt
export const config = {
api: {
bodyParser: false,
},
};

// Haupt-Handler-Funktion für die Serverless Function
export default async function handler(req, res) {
if (req.method !== 'POST') {
res.status(405).json({ message: 'Nur POST-Anfragen erlaubt.' });
return;
}

try {
    // 1. FormData parsen
    const { fields, files } = await parseForm(req);
    
    // fields enthält ein Array, daher müssen wir den ersten Eintrag nehmen ([0])
    const modelName = fields.modelName?.[0]?.trim();
    const zipFile = files.file?.[0]; // files enthält auch ein Array

    if (!modelName || !zipFile) {
        return res.status(400).json({ message: 'Modellname oder ZIP-Datei fehlen.' });
    }

    if (zipFile.originalFilename.split('.').pop().toLowerCase() !== 'zip') {
         return res.status(400).json({ message: 'Nur ZIP-Dateien sind erlaubt.' });
    }

    // 2. ZIP-Datei lesen und entpacken
    // Node.js fs wird von Vercel unterstützt
    const zipData = require('fs').readFileSync(zipFile.filepath);
    const zip = await JSZip.loadAsync(zipData);

    let modelFile = null;
    let textureFile = null;
    let modelExtension = '';

    // Unterstützte 3D-Modellformate
    const modelExtensions = ['.obj', '.gltf', '.glb', '.json']; 

    // Durchsuche die ZIP-Inhalte nach Modell und Textur
    zip.forEach((relativePath, zipEntry) => {
        const fileName = relativePath.toLowerCase();
        
        // Textur (.png) erkennen
        if (fileName.endsWith('.png') && !zipEntry.dir && !textureFile) {
            textureFile = zipEntry;
        }
        
        // 3D Modell erkennen
        const ext = modelExtensions.find(e => fileName.endsWith(e));
        if (ext && !zipEntry.dir && !modelFile) {
            modelFile = zipEntry;
            modelExtension = ext;
        }
    });

    if (!modelFile) {
        return res.status(400).json({ message: 'Keine unterstützte Modelldatei (.obj, .gltf, .glb, .json) in der ZIP gefunden.' });
    }
    if (!textureFile) {
         return res.status(400).json({ message: 'Keine Texturdatei (.png) in der ZIP gefunden.' });
    }
    
    // Generiere eine eindeutige ID (UUID) für das Modell
    const modelId = require('crypto').randomUUID();

    // 3. Dateien speichern (Vercel Blob Storage)
    
    // A. Modelldaten
    const modelBuffer = await modelFile.async('nodebuffer');
    // Speichere die Datei mit der korrekten Endung (z.B. model.obj)
    const modelBlob = await put(`models/${modelId}/model${modelExtension}`, modelBuffer, { access: 'public' });

    // B. Texturdaten
    const textureBuffer = await textureFile.async('nodebuffer');
    // Speichere die Textur
    const textureBlob = await put(`models/${modelId}/texture.png`, textureBuffer, { access: 'public' });
    
    // 4. Metadaten speichern (WICHTIG für List-, Delete- und Thumbnail-Funktionen!)
    const newModelMetadata = {
        id: modelId,
        name: modelName,
        modelUrl: modelBlob.url,
        textureUrl: textureBlob.url,
        modelType: modelExtension.substring(1), // obj, gltf, etc.
        status: 'Uploaded', // Wird später auf 'Ready' gesetzt, wenn Thumbnail fertig
        timestamp: Date.now(),
    };

    // Speichere die Metadaten
    await put(`models/${modelId}/metadata.json`, JSON.stringify(newModelMetadata), { 
        access: 'public', 
        contentType: 'application/json' 
    });

    
    // 5. Trigger für Thumbnail-Rendering (läuft im Hintergrund)
    // Nutze req.headers.origin, um die Basis-URL des Servers zu erhalten
    fetch(`${req.headers.origin}/api/thumbnail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: modelId }),
    }).catch(err => console.error('Fehler beim Starten des Thumbnail-Renderers:', err));

    // 6. Erfolgreiche Antwort zurücksenden
    res.status(200).json({ 
        id: modelId, 
        name: modelName, 
        message: 'Upload erfolgreich, Rendering läuft im Hintergrund.',
    });

} catch (error) {
    console.error('SERVER FEHLER:', error);
    res.status(500).json({ message: `Interner Serverfehler: ${error.message}` });
}


}