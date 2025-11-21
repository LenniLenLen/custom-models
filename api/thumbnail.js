// Die API-Datei, die für das Rendern eines 3D-Modells und die Speicherung des Screenshots
// als Thumbnail zuständig ist. Diese Datei muss im Ordner 'api/' deines Vercel-Projekts gespeichert werden.
//
// WICHTIG: Dieses Skript verwendet Puppeteer (Chrome Headless) und erfordert die 
// spezielle Konfiguration in der 'vercel.json' (die wir bereits erstellt haben).

import { put } from '@vercel/blob';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { get } from '@vercel/blob';

// Timeout für die Serverless Function erhöhen, da Rendern lange dauern kann
export const config = {
    maxDuration: 300, 
};

// Haupt-Handler-Funktion für die Serverless Function
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ message: 'Nur POST-Anfragen erlaubt.' });
        return;
    }

    // Die Model-ID wird über den POST-Body vom upload.js-Skript übergeben
    const { modelId } = req.body;

    if (!modelId) {
        return res.status(400).json({ message: 'Fehlende Modell-ID im Body.' });
    }

    let browser = null;
    let screenshotBuffer = null;
    let metadata;
    let thumbnailBlobUrl = null;

    try {
        // 1. Browser initialisieren
        browser = await puppeteer.launch({
            args: [...chromium.args, "--hide-scrollbars", "--disable-web-security"],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        
        // Definiere die Größe des Viewports (muss zur RENDER_SIZE in render.html passen)
        const RENDER_SIZE = 256; 
        await page.setViewport({ width: RENDER_SIZE, height: RENDER_SIZE });
        
        // Baue die URL zum Renderer-HTML. Wir verwenden die aktuelle Host-URL.
        const rendererUrl = `${req.headers.origin}/render.html?id=${modelId}`;

        // 2. Navigiere zur Render-Seite und warte auf das "RenderingFinished"-Signal
        await page.goto(rendererUrl, { waitUntil: 'networkidle0' });

        // Warte, bis die globale JavaScript-Variable auf true gesetzt wird
        // (Dies signalisiert, dass Three.js das Modell geladen und 60 Frames gerendert hat)
        await page.waitForFunction('window.renderingFinished === true', {
             timeout: 60000 // 60 Sekunden Timeout
        });

        // 3. Screenshot erstellen
        screenshotBuffer = await page.screenshot({ 
            type: 'png',
            encoding: 'binary',
            omitBackground: true // WICHTIG: Transparenz beibehalten
        });

        // 4. Thumbnail im Blob Storage speichern
        const thumbnailBlob = await put(`models/${modelId}/thumbnail.png`, screenshotBuffer, { 
            access: 'public', 
            contentType: 'image/png' 
        });
        thumbnailBlobUrl = thumbnailBlob.url;

        // 5. Metadaten-JSON aktualisieren
        const metadataPath = `models/${modelId}/metadata.json`;
        
        // Zuerst die alte Metadaten-Datei laden
        const oldMetadataUrl = `${req.headers.origin}/${metadataPath}`;
        const metaResponse = await fetch(oldMetadataUrl);

        if (!metaResponse.ok) {
             throw new Error("Fehler beim Abrufen der alten Metadaten.");
        }
        metadata = await metaResponse.json();

        // Metadaten aktualisieren
        metadata.status = 'Ready';
        metadata.thumbnailUrl = thumbnailBlobUrl;

        // Aktualisierte Metadaten im Blob Storage speichern
        await put(metadataPath, JSON.stringify(metadata), { 
            access: 'public', 
            contentType: 'application/json' 
        });


        // 6. Erfolgreiche Antwort zurücksenden (wird vom uploader nicht abgefangen, dient nur dem Logging)
        res.status(200).json({ 
            id: modelId, 
            status: 'success', 
            thumbnailUrl: thumbnailBlobUrl 
        });

    } catch (error) {
        console.error(`FEHLER beim Rendern für ID ${modelId}:`, error);
        
        // Fange den Fall ab, in dem das Metadaten-Update fehlschlägt, 
        // und setze den Status auf 'Error'
        if (metadata) {
            try {
                metadata.status = 'Error';
                const metadataPath = `models/${modelId}/metadata.json`;
                await put(metadataPath, JSON.stringify(metadata), { 
                    access: 'public', 
                    contentType: 'application/json' 
                });
            } catch (updateError) {
                console.error("Kritischer Fehler: Konnte Status nicht auf 'Error' aktualisieren.", updateError);
            }
        }

        res.status(500).json({ 
            status: 'error', 
            message: `Thumbnail-Rendering fehlgeschlagen: ${error.message}` 
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}