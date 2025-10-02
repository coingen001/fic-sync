/**
 * ════════════════════════════════════════════════════════════════════
 * FATTURE IN CLOUD SYNC - IMPORT AUTOMATICO
 * ════════════════════════════════════════════════════════════════════
 * 
 * ISTRUZIONI PER L'UTENTE:
 * 
 * 1. Nel foglio Store.link: Estensioni → Apps Script
 * 2. Copia TUTTO questo codice (Ctrl+A, Ctrl+C)
 * 3. Incolla qui (sostituisci tutto il contenuto)
 * 4. Salva (Ctrl+S)
 * 5. Seleziona funzione: IMPORTA_FIC_SYNC
 * 6. Clicca ▶️ Esegui
 * 7. Autorizza quando richiesto
 * 8. Attendi completamento (30-60 secondi)
 * 9. Ricarica il foglio (F5)
 * 
 * ✅ Fatto! Il menu apparirà!
 * 
 * ════════════════════════════════════════════════════════════════════
 */

// MODIFICA QUESTO URL CON IL TUO FILE SU GITHUB O GOOGLE DRIVE
const CODE_SOURCE_URL = 'TUO_URL_QUI';

function IMPORTA_FIC_SYNC() {
  const ui = SpreadsheetApp.getUi();
  
  const response = ui.alert(
    'Import Fatture in Cloud Sync',
    'Questa procedura installerà automaticamente tutto il necessario.\n\n' +
    'Tempo stimato: 30-60 secondi\n\n' +
    'Vuoi procedere?',
    ui.ButtonSet.YES_NO
  );
  
  if (response !== ui.Button.YES) {
    ui.alert('Import annullato.');
    return;
  }
  
  try {
    ui.alert('Download...', 'Scaricamento codice dal server...', ui.ButtonSet.OK);
    const code = downloadCode();
    
    ui.alert('Installazione...', 'Installazione moduli...', ui.ButtonSet.OK);
    eval(code);
    
    ui.alert('Configurazione...', 'Creazione fogli e trigger...', ui.ButtonSet.OK);
    Utilities.sleep(2000);
    
    if (typeof INSTALLA_FIC_SYNC === 'function') {
      INSTALLA_FIC_SYNC();
    } else {
      throw new Error('Funzione INSTALLA_FIC_SYNC non trovata dopo import');
    }
    
  } catch (error) {
    ui.alert(
      'Errore Import',
      'Si è verificato un errore:\n\n' + error.message + '\n\n' +
      'Possibili cause:\n' +
      '• Connessione internet assente\n' +
      '• URL del codice non valido\n' +
      '• Problema di autorizzazioni\n\n' +
      'Riprova o contatta il supporto.',
      ui.ButtonSet.OK
    );
    console.error('Errore import:', error);
  }
}

function downloadCode() {
  try {
    const response = UrlFetchApp.fetch(CODE_SOURCE_URL);
    const code = response.getContentText();
    
    if (!code || code.length < 100) {
      throw new Error('Codice scaricato non valido (troppo corto)');
    }
    
    console.log('Codice scaricato: ' + code.length + ' caratteri');
    return code;
    
  } catch (error) {
    throw new Error('Impossibile scaricare il codice: ' + error.message);
  }
}
