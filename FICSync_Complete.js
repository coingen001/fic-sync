/**
 * ════════════════════════════════════════════════════════════════════
 * FATTURE IN CLOUD SYNC - CODICE COMPLETO
 * ════════════════════════════════════════════════════════════════════
 * Versione: 1.0.0
 * Data: 2025-10-02
 * Autore: Sistema di Sincronizzazione Store.link ↔ Fatture in Cloud
 * 
 * Questo file contiene TUTTO il codice necessario per:
 * - Sincronizzazione prodotti da Fatture in Cloud
 * - Importazione ordini in Fatture in Cloud
 * - Gestione clienti automatica
 * - Menu e interfacce utente
 * - Sicurezza e crittografia credenziali
 * 
 * IMPORTANTE: Non modificare questo file direttamente!
 * ════════════════════════════════════════════════════════════════════
 */

// ============================================
// SECURITY - Gestione Sicura Credenziali
// ============================================

class SecurityManager {
  
  constructor() {
    this.scriptProperties = PropertiesService.getScriptProperties();
    this.encryptionKey = this._generateEncryptionKey();
  }
  
  _generateEncryptionKey() {
    const scriptId = ScriptApp.getScriptId();
    const salt = 'FIC-SYNC-2025';
    const combined = scriptId + salt;
    return Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, 
      combined,
      Utilities.Charset.UTF_8
    );
  }
  
  encrypt(plainText) {
    if (!plainText) return '';
    
    try {
      const textBytes = Utilities.newBlob(plainText).getBytes();
      const keyBytes = this.encryptionKey;
      
      const encrypted = textBytes.map((byte, i) => 
        byte ^ keyBytes[i % keyBytes.length]
      );
      
      return Utilities.base64Encode(encrypted);
      
    } catch (error) {
      logError('Encryption failed', { error: error.message });
      throw new Error('Impossibile criptare i dati');
    }
  }
  
  decrypt(encryptedText) {
    if (!encryptedText) return '';
    
    try {
      const encryptedBytes = Utilities.base64Decode(encryptedText);
      const keyBytes = this.encryptionKey;
      
      const decrypted = encryptedBytes.map((byte, i) => 
        byte ^ keyBytes[i % keyBytes.length]
      );
      
      return Utilities.newBlob(decrypted).getDataAsString();
      
    } catch (error) {
      logError('Decryption failed', { error: error.message });
      throw new Error('Impossibile decriptare i dati');
    }
  }
  
  saveCredential(key, value) {
    const encrypted = this.encrypt(value);
    this.scriptProperties.setProperty(key, encrypted);
    logInfo(`Credential saved securely: ${key}`);
  }
  
  getCredential(key) {
    const encrypted = this.scriptProperties.getProperty(key);
    if (!encrypted) return null;
    return this.decrypt(encrypted);
  }
  
  deleteCredential(key) {
    this.scriptProperties.deleteProperty(key);
    logInfo(`Credential deleted: ${key}`);
  }
  
  validateApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
      return { valid: false, error: 'API Key non valida' };
    }
    
    if (apiKey.length < 30) {
      return { valid: false, error: 'API Key troppo corta' };
    }
    
    if (!/^[a-zA-Z0-9_\-\.]+$/.test(apiKey)) {
      return { valid: false, error: 'API Key contiene caratteri non validi' };
    }
    
    return { valid: true };
  }
  
  validateCompanyId(companyId) {
    const id = parseInt(companyId);
    
    if (isNaN(id) || id <= 0) {
      return { valid: false, error: 'Company ID deve essere un numero positivo' };
    }
    
    return { valid: true };
  }
  
  sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    
    return input
      .replace(/[<>]/g, '')
      .replace(/['";]/g, '')
      .trim();
  }
  
  maskApiKey(apiKey) {
    if (!apiKey || apiKey.length < 8) return '***';
    return apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4);
  }
}

class RateLimiter {
  
  constructor(maxRequests = 100, windowMinutes = 60) {
    this.maxRequests = maxRequests;
    this.windowMinutes = windowMinutes;
    this.cache = CacheService.getScriptCache();
  }
  
  checkLimit(userId) {
    const key = `rate_limit_${userId}`;
    const data = this.cache.get(key);
    
    let requestCount = 1;
    
    if (data) {
      const parsed = JSON.parse(data);
      requestCount = parsed.count + 1;
      
      if (requestCount > this.maxRequests) {
        throw new Error(
          `Rate limit superato. Massimo ${this.maxRequests} richieste ogni ${this.windowMinutes} minuti.`
        );
      }
    }
    
    this.cache.put(
      key, 
      JSON.stringify({ count: requestCount }), 
      this.windowMinutes * 60
    );
    
    return true;
  }
  
  reset(userId) {
    const key = `rate_limit_${userId}`;
    this.cache.remove(key);
  }
}

class CircuitBreaker {
  
  constructor(failureThreshold = 5, resetTimeout = 60000) {
    this.failureThreshold = failureThreshold;
    this.resetTimeout = resetTimeout;
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = null;
  }
  
  execute(apiCall) {
    if (this.state === 'OPEN') {
      const now = Date.now();
      
      if (now - this.lastFailureTime >= this.resetTimeout) {
        this.state = 'HALF_OPEN';
        this.failureCount = 0;
        logInfo('Circuit breaker: tentativo di recupero (HALF_OPEN)');
      } else {
        throw new Error('Circuit breaker OPEN: servizio temporaneamente non disponibile');
      }
    }
    
    try {
      const result = apiCall();
      
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        logInfo('Circuit breaker: servizio ripristinato (CLOSED)');
      }
      
      this.failureCount = 0;
      return result;
      
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      
      logError('Circuit breaker: chiamata fallita', {
        failureCount: this.failureCount,
        threshold: this.failureThreshold
      });
      
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'OPEN';
        logError('Circuit breaker: APERTO - troppe failure consecutive');
      }
      
      throw error;
    }
  }
  
  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = null;
  }
}

// ============================================
// CONFIG - Configurazione Sicura
// ============================================

const security = new SecurityManager();
const rateLimiter = new RateLimiter(100, 60);
const circuitBreaker = new CircuitBreaker(5, 300000);

function loadConfig() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CONFIG');
    
    if (!sheet) {
      console.warn('⚠️ Foglio CONFIG non trovato, uso valori di default');
      return {
        SYNC_INTERVAL_HOURS: 1,
        FIC_DOC_TYPE: 'invoice',
        FIC_PAYMENT_METHOD_ID: 3,
        FIC_PAYMENT_METHOD_NAME: 'Bonifico bancario',
        FIC_VAT_RATE: 22,
        LOG_ENABLED: true,
        SHEET_ARTICOLI: 'ARTICOLI',
        SHEET_ORDINI: 'ORDINI'
      };
    }
    
    const data = sheet.getRange('A2:B11').getValues();
    const config = {};
    
    data.forEach(row => {
      const key = row[0];
      let value = row[1];
      
      if (value === 'TRUE') value = true;
      if (value === 'FALSE') value = false;
      if (key.includes('_ID') || key === 'SYNC_INTERVAL_HOURS' || key === 'FIC_VAT_RATE') {
        value = parseFloat(value) || 0;
      }
      
      config[key] = value;
    });
    
    return config;
    
  } catch (error) {
    console.error('❌ Errore in loadConfig:', error.message);
    return {
      SYNC_INTERVAL_HOURS: 1,
      FIC_DOC_TYPE: 'invoice',
      FIC_PAYMENT_METHOD_ID: 3,
      FIC_PAYMENT_METHOD_NAME: 'Bonifico bancario',
      FIC_VAT_RATE: 22,
      LOG_ENABLED: true,
      SHEET_ARTICOLI: 'ARTICOLI',
      SHEET_ORDINI: 'ORDINI'
    };
  }
}

const CONFIG = {
  get FIC_API_KEY() { 
    return security.getCredential('FIC_API_KEY'); 
  },
  get FIC_COMPANY_ID() { 
    const id = security.getCredential('FIC_COMPANY_ID');
    return id ? parseInt(id) : null;
  },
  
  get FIC_BASE_URL() { 
    return 'https://api-v2.fattureincloud.it'; 
  },
  
  get SYNC_INTERVAL_HOURS() { return loadConfig().SYNC_INTERVAL_HOURS; },
  get FIC_DOC_TYPE() { return loadConfig().FIC_DOC_TYPE; },
  get FIC_VAT_RATE() { return loadConfig().FIC_VAT_RATE; },
  get LOG_ENABLED() { return loadConfig().LOG_ENABLED; },
  get SHEET_ARTICOLI() { return loadConfig().SHEET_ARTICOLI; },
  get SHEET_ORDINI() { return loadConfig().SHEET_ORDINI; },
  
  ARTICOLI_COLS: {
    NAME: 1, CATEGORY: 2, PRICE: 3, DISCOUNTED_PRICE: 4,
    DESCRIPTION: 5, BRAND: 6, STOCK: 10,
    FIC_ID: 15, FIC_CODE: 16, LAST_SYNC: 17
  },
  
  ORDINI_COLS: {
    ORDER_NO: 1, DATE: 2, SHIPPING_METHOD: 3, TRANSACTION_ID: 4,
    PRODUCTS: 5, ORDER_TOTAL: 6, CUSTOMER_NAME: 7, EMAIL: 8,
    PHONE: 9, ADDRESS: 10, CITY: 11, POSTAL_CODE: 12,
    COUNTRY: 13, STATE: 14,
    FIC_STATUS: 15, FIC_DOC_ID: 16, FIC_CLIENT_ID: 17,
    FIC_ERROR: 18, SYNC_DATE: 19
  },
  
  get FIC_PAYMENT_METHOD() {
    const cfg = loadConfig();
    return {
      id: cfg.FIC_PAYMENT_METHOD_ID,
      name: cfg.FIC_PAYMENT_METHOD_NAME
    };
  }
};

function saveSecureCredentials(apiKey, companyId) {
  const apiKeyValidation = security.validateApiKey(apiKey);
  if (!apiKeyValidation.valid) {
    throw new Error(apiKeyValidation.error);
  }
  
  const companyIdValidation = security.validateCompanyId(companyId);
  if (!companyIdValidation.valid) {
    throw new Error(companyIdValidation.error);
  }
  
  apiKey = security.sanitizeInput(apiKey);
  
  security.saveCredential('FIC_API_KEY', apiKey);
  security.saveCredential('FIC_COMPANY_ID', companyId.toString());
  
  logInfo('Credenziali salvate', {
    apiKey: security.maskApiKey(apiKey),
    companyId: companyId
  });
  
  return true;
}

function saveAndTestCredentials(apiKey, companyId) {
  try {
    saveSecureCredentials(apiKey, companyId);
    
    const api = new FattureInCloudAPI();
    const result = api.testConnection();
    
    return result;
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  }
}

function deleteSecureCredentials() {
  security.deleteCredential('FIC_API_KEY');
  security.deleteCredential('FIC_COMPANY_ID');
  logInfo('Credenziali eliminate');
}

function validateConfig() {
  const errors = [];
  
  const apiKey = CONFIG.FIC_API_KEY;
  if (!apiKey) {
    errors.push('⚠️ API Key mancante');
  } else {
    const validation = security.validateApiKey(apiKey);
    if (!validation.valid) {
      errors.push(`⚠️ API Key: ${validation.error}`);
    }
  }
  
  const companyId = CONFIG.FIC_COMPANY_ID;
  if (!companyId) {
    errors.push('⚠️ Company ID mancante');
  } else {
    const validation = security.validateCompanyId(companyId);
    if (!validation.valid) {
      errors.push(`⚠️ Company ID: ${validation.error}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors: errors
  };
}

// ============================================
// UTILS - Utility e Logging
// ============================================

function logInfo(message, data = null) {
  if (!CONFIG.LOG_ENABLED) return;
  
  const timestamp = new Date().toISOString();
  const logMessage = `[INFO] ${timestamp} - ${message}`;
  
  console.log(logMessage);
  if (data) console.log(JSON.stringify(data, null, 2));
  
  writeToLogSheet('INFO', message, data);
}

function logError(message, data = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `[ERROR] ${timestamp} - ${message}`;
  
  console.error(logMessage);
  if (data) console.error(JSON.stringify(data, null, 2));
  
  writeToLogSheet('ERROR', message, data);
}

function writeToLogSheet(level, message, data) {
  try {
    let logSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('LOG');
    
    if (!logSheet) {
      logSheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet('LOG');
      logSheet.getRange(1, 1, 1, 4).setValues([['Timestamp', 'Level', 'Message', 'Data']]);
      logSheet.setFrozenRows(1);
    }
    
    const lastRow = logSheet.getLastRow() + 1;
    logSheet.getRange(lastRow, 1, 1, 4).setValues([[
      new Date(),
      level,
      message,
      data ? JSON.stringify(data) : ''
    ]]);
    
    if (level === 'ERROR') {
      logSheet.getRange(lastRow, 1, 1, 4).setBackground('#ffebee');
    }
    
  } catch (e) {
    console.log('Impossibile scrivere in LOG sheet:', e.message);
  }
}

function formatDateForFIC(date) {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

// ============================================
// FATTUREINCLOUD API - Con Sicurezza
// ============================================

class FattureInCloudAPI {
  
  constructor() {
    this.baseUrl = CONFIG.FIC_BASE_URL;
    this.apiKey = CONFIG.FIC_API_KEY;
    this.companyId = CONFIG.FIC_COMPANY_ID;
    this.userId = Session.getActiveUser().getEmail();
    
    if (!this.apiKey || !this.companyId) {
      throw new Error('Credenziali mancanti. Configura prima API Key e Company ID.');
    }
  }
  
  _request(endpoint, method = 'GET', payload = null, retryCount = 0) {
    const maxRetries = 3;
    
    try {
      rateLimiter.checkLimit(this.userId);
    } catch (error) {
      logError('Rate limit exceeded', { user: this.userId });
      throw error;
    }
    
    const url = `${this.baseUrl}/c/${this.companyId}${endpoint}`;
    
    const options = {
      method: method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'StoreLink-Sync/1.0'
      },
      muteHttpExceptions: true
    };
    
    if (payload) {
      const sanitized = this._sanitizePayload(payload);
      options.payload = JSON.stringify(sanitized);
    }
    
    try {
      return circuitBreaker.execute(() => {
        const response = UrlFetchApp.fetch(url, options);
        const code = response.getResponseCode();
        const content = response.getContentText();
        
        if (code >= 200 && code < 300) {
          return JSON.parse(content);
        }
        
        if (code === 401) {
          throw new Error('❌ API Key non valida o scaduta');
        }
        if (code === 404) {
          throw new Error('❌ Company ID non trovato');
        }
        if (code === 429) {
          if (retryCount < maxRetries) {
            const delay = Math.pow(2, retryCount) * 1000;
            logInfo(`Rate limit API, retry tra ${delay}ms...`);
            Utilities.sleep(delay);
            return this._request(endpoint, method, payload, retryCount + 1);
          }
          throw new Error('❌ Troppi tentativi, riprova più tardi');
        }
        if (code >= 500) {
          if (retryCount < maxRetries) {
            const delay = 2000 * (retryCount + 1);
            logInfo(`Errore server, retry tra ${delay}ms...`);
            Utilities.sleep(delay);
            return this._request(endpoint, method, payload, retryCount + 1);
          }
          throw new Error('❌ Servizio temporaneamente non disponibile');
        }
        
        throw new Error(`API Error ${code}: ${content}`);
      });
      
    } catch (error) {
      logError('FIC API Request Failed', { 
        endpoint, 
        method, 
        error: error.message,
        user: this.userId
      });
      throw error;
    }
  }
  
  _sanitizePayload(payload) {
    if (typeof payload !== 'object') return payload;
    
    const sanitized = {};
    
    for (const key in payload) {
      let value = payload[key];
      
      if (typeof value === 'string') {
        value = security.sanitizeInput(value);
      } else if (typeof value === 'object' && value !== null) {
        value = this._sanitizePayload(value);
      }
      
      sanitized[key] = value;
    }
    
    return sanitized;
  }
  
  testConnection() {
    try {
      const response = this._request('/products?per_page=1');
      return {
        success: true,
        message: 'Connessione OK',
        data: response
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }
  
  getProducts(page = 1, perPage = 50) {
    return this._request(`/products?page=${page}&per_page=${perPage}`);
  }
  
  upsertProduct(productData) {
    if (productData.id) {
      return this._request(`/products/${productData.id}`, 'PUT', { data: productData });
    } else {
      return this._request('/products', 'POST', { data: productData });
    }
  }
  
  findClientByEmail(email) {
    const response = this._request(`/entities/clients?q=${encodeURIComponent(email)}`);
    
    if (response.data && response.data.length > 0) {
      return response.data.find(c => c.email === email) || null;
    }
    return null;
  }
  
  createClient(clientData) {
    return this._request('/entities/clients', 'POST', { data: clientData });
  }
  
  createDocument(docType, documentData) {
    return this._request('/issued_documents', 'POST', { data: documentData });
  }
  
  findProductByCode(code) {
    const response = this._request(`/products?q=${encodeURIComponent(code)}`);
    
    if (response.data && response.data.length > 0) {
      return response.data.find(p => p.code === code) || null;
    }
    return null;
  }
}

// ============================================
// SYNC PRODOTTI
// ============================================

function syncProdottiFromFIC() {
  logInfo('=== INIZIO SYNC PRODOTTI ===');
  
  try {
    const api = new FattureInCloudAPI();
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_ARTICOLI);
    
    if (!sheet) {
      throw new Error(`Foglio ${CONFIG.SHEET_ARTICOLI} non trovato`);
    }
    
    let allProducts = [];
    let page = 1;
    let hasMore = true;
    
    while (hasMore) {
      const response = api.getProducts(page, 50);
      allProducts = allProducts.concat(response.data || []);
      
      hasMore = response.current_page < response.last_page;
      page++;
      
      if (page > 20) break;
    }
    
    logInfo(`Trovati ${allProducts.length} prodotti in Fatture in Cloud`);
    
    const existingProducts = getExistingProductsMap(sheet);
    
    let countNew = 0;
    let countUpdated = 0;
    
    allProducts.forEach(ficProduct => {
      if (existingProducts.has(ficProduct.id)) {
        updateProductRow(sheet, existingProducts.get(ficProduct.id), ficProduct);
        countUpdated++;
      } else {
        addProductRow(sheet, ficProduct);
        countNew++;
      }
    });
    
    logInfo(`Sync completata: ${countNew} nuovi, ${countUpdated} aggiornati`);
    
    SpreadsheetApp.getUi().alert(
      '✅ Sync Prodotti Completata',
      `Nuovi: ${countNew}\nAggiornati: ${countUpdated}\nTotale: ${allProducts.length}`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    
  } catch (error) {
    logError('Sync Prodotti Fallita', { error: error.message, stack: error.stack });
    SpreadsheetApp.getUi().alert('❌ Errore Sync Prodotti', error.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

function getExistingProductsMap(sheet) {
  const map = new Map();
  const lastRow = sheet.getLastRow();
  
  if (lastRow < 2) return map;
  
  const ficIdCol = CONFIG.ARTICOLI_COLS.FIC_ID;
  const ficIds = sheet.getRange(2, ficIdCol, lastRow - 1, 1).getValues();
  
  ficIds.forEach((row, index) => {
    if (row[0]) {
      map.set(row[0], index + 2);
    }
  });
  
  return map;
}

function updateProductRow(sheet, rowNumber, ficProduct) {
  const cols = CONFIG.ARTICOLI_COLS;
  
  sheet.getRange(rowNumber, cols.NAME).setValue(ficProduct.name || '');
  sheet.getRange(rowNumber, cols.PRICE).setValue(ficProduct.net_price || 0);
  sheet.getRange(rowNumber, cols.DESCRIPTION).setValue(ficProduct.description || '');
  sheet.getRange(rowNumber, cols.STOCK).setValue(ficProduct.stock || 0);
  sheet.getRange(rowNumber, cols.FIC_CODE).setValue(ficProduct.code || '');
  sheet.getRange(rowNumber, cols.LAST_SYNC).setValue(new Date());
}

function addProductRow(sheet, ficProduct) {
  const cols = CONFIG.ARTICOLI_COLS;
  const newRow = sheet.getLastRow() + 1;
  
  sheet.getRange(newRow, cols.NAME).setValue(ficProduct.name || '');
  sheet.getRange(newRow, cols.CATEGORY).setValue(ficProduct.category || 'Generale');
  sheet.getRange(newRow, cols.PRICE).setValue(ficProduct.net_price || 0);
  sheet.getRange(newRow, cols.DESCRIPTION).setValue(ficProduct.description || '');
  sheet.getRange(newRow, cols.BRAND).setValue(ficProduct.brand || '');
  sheet.getRange(newRow, cols.STOCK).setValue(ficProduct.stock || 0);
  sheet.getRange(newRow, cols.FIC_ID).setValue(ficProduct.id);
  sheet.getRange(newRow, cols.FIC_CODE).setValue(ficProduct.code || '');
  sheet.getRange(newRow, cols.LAST_SYNC).setValue(new Date());
}

// ============================================
// SYNC ORDINI
// ============================================

function onOrderSheetEdit(e) {
  const sheet = e.source.getActiveSheet();
  if (sheet.getName() !== CONFIG.SHEET_ORDINI) return;
  
  const range = e.range;
  const row = range.getRow();
  
  if (row < 2) return;
  
  const statusCol = CONFIG.ORDINI_COLS.FIC_STATUS;
  const status = sheet.getRange(row, statusCol).getValue();
  
  if (!status || status === '') {
    processNewOrder(sheet, row);
  }
}

function processPendingOrders() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_ORDINI);
  const lastRow = sheet.getLastRow();
  
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('Nessun ordine da processare');
    return;
  }
  
  const statusCol = CONFIG.ORDINI_COLS.FIC_STATUS;
  const statuses = sheet.getRange(2, statusCol, lastRow - 1, 1).getValues();
  
  let processed = 0;
  
  statuses.forEach((row, index) => {
    if (row[0] === '' || row[0] === 'PENDING' || row[0] === 'ERROR') {
      const rowNumber = index + 2;
      processNewOrder(sheet, rowNumber);
      processed++;
      Utilities.sleep(1000);
    }
  });
  
  SpreadsheetApp.getUi().alert(
    '✅ Importazione Completata',
    `Ordini processati: ${processed}`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function processNewOrder(sheet, rowNumber) {
  const cols = CONFIG.ORDINI_COLS;
  
  try {
    sheet.getRange(rowNumber, cols.FIC_STATUS).setValue('PENDING');
    
    const orderData = readOrderData(sheet, rowNumber);
    
    logInfo(`Processando ordine: ${orderData.orderNo}`);
    
    const api = new FattureInCloudAPI();
    
    let clientId;
    const existingClient = api.findClientByEmail(orderData.email);
    
    if (existingClient) {
      clientId = existingClient.id;
      logInfo(`Cliente esistente: ${clientId}`);
    } else {
      const newClient = api.createClient({
        name: orderData.customerName,
        email: orderData.email,
        phone: orderData.phone,
        address_street: orderData.address,
        address_city: orderData.city,
        address_postal_code: orderData.postalCode,
        address_province: orderData.state,
        country: orderData.country || 'Italia',
        type: 'company'
      });
      clientId = newClient.data.id;
      logInfo(`Nuovo cliente creato: ${clientId}`);
    }
    
    sheet.getRange(rowNumber, cols.FIC_CLIENT_ID).setValue(clientId);
    
    const productsForDoc = parseOrderProducts(orderData.products);
    
    const document = api.createDocument(CONFIG.FIC_DOC_TYPE, {
      type: CONFIG.FIC_DOC_TYPE,
      entity: {
        id: clientId
      },
      date: formatDateForFIC(orderData.date),
      number: orderData.orderNo,
      numeration: '/A',
      subject: `Ordine ${orderData.orderNo}`,
      items: productsForDoc,
      payments_list: [{
        amount: orderData.orderTotal,
        due_date: formatDateForFIC(new Date()),
        payment_terms: {
          days: 30,
          type: 'standard'
        },
        paid_date: orderData.transactionId ? formatDateForFIC(orderData.date) : null,
        status: orderData.transactionId ? 'paid' : 'not_paid',
        payment_account: CONFIG.FIC_PAYMENT_METHOD
      }]
    });
    
    const docId = document.data.id;
    
    sheet.getRange(rowNumber, cols.FIC_STATUS).setValue('IMPORTED');
    sheet.getRange(rowNumber, cols.FIC_DOC_ID).setValue(docId);
    sheet.getRange(rowNumber, cols.SYNC_DATE).setValue(new Date());
    sheet.getRange(rowNumber, cols.FIC_ERROR).setValue('');
    
    logInfo(`✅ Ordine ${orderData.orderNo} importato. Doc ID: ${docId}`);
    
  } catch (error) {
    sheet.getRange(rowNumber, cols.FIC_STATUS).setValue('ERROR');
    sheet.getRange(rowNumber, cols.FIC_ERROR).setValue(error.message.substring(0, 200));
    
    logError('Errore importazione ordine', { 
      row: rowNumber, 
      error: error.message 
    });
  }
}

function readOrderData(sheet, rowNumber) {
  const cols = CONFIG.ORDINI_COLS;
  
  return {
    orderNo: sheet.getRange(rowNumber, cols.ORDER_NO).getValue(),
    date: sheet.getRange(rowNumber, cols.DATE).getValue(),
    shippingMethod: sheet.getRange(rowNumber, cols.SHIPPING_METHOD).getValue(),
    transactionId: sheet.getRange(rowNumber, cols.TRANSACTION_ID).getValue(),
    products: sheet.getRange(rowNumber, cols.PRODUCTS).getValue(),
    orderTotal: sheet.getRange(rowNumber, cols.ORDER_TOTAL).getValue(),
    customerName: sheet.getRange(rowNumber, cols.CUSTOMER_NAME).getValue(),
    email: sheet.getRange(rowNumber, cols.EMAIL).getValue(),
    phone: sheet.getRange(rowNumber, cols.PHONE).getValue(),
    address: sheet.getRange(rowNumber, cols.ADDRESS).getValue(),
    city: sheet.getRange(rowNumber, cols.CITY).getValue(),
    postalCode: sheet.getRange(rowNumber, cols.POSTAL_CODE).getValue(),
    country: sheet.getRange(rowNumber, cols.COUNTRY).getValue(),
    state: sheet.getRange(rowNumber, cols.STATE).getValue()
  };
}

function parseOrderProducts(productsString) {
  const items = [];
  const productLines = productsString.split(',').map(s => s.trim());
  
  productLines.forEach(line => {
    const match = line.match(/^(.+?)\s+x(\d+)$/);
    
    if (match) {
      const name = match[1].trim();
      const qty = parseInt(match[2]);
      const price = findProductPrice(name);
      
      items.push({
        name: name,
        qty: qty,
        net_price: price,
        vat: {
          id: 0,
          value: CONFIG.FIC_VAT_RATE
        }
      });
    }
  });
  
  return items;
}

function findProductPrice(productName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_ARTICOLI);
  const lastRow = sheet.getLastRow();
  
  if (lastRow < 2) return 0;
  
  const nameCol = CONFIG.ARTICOLI_COLS.NAME;
  const priceCol = CONFIG.ARTICOLI_COLS.PRICE;
  
  const names = sheet.getRange(2, nameCol, lastRow - 1, 1).getValues();
  const prices = sheet.getRange(2, priceCol, lastRow - 1, 1).getValues();
  
  for (let i = 0; i < names.length; i++) {
    if (names[i][0] === productName) {
      return prices[i][0] || 0;
    }
  }
  
  return 0;
}

// ============================================
// SETUP E MENU
// ============================================

function onOpen() {
  try {
    const ui = SpreadsheetApp.getUi();
    
    ui.createMenu('🔄 Sync Fatture in Cloud')
      .addItem('🚀 Setup Iniziale', 'setupInitialStructure')
      .addItem('📚 Guida Setup', 'showSetupGuide')
      .addSeparator()
      .addItem('⚙️ Configura Credenziali', 'showConfigDialog')
      .addItem('✅ Verifica Configurazione', 'testConfiguration')
      .addSeparator()
      .addItem('🔄 Sincronizza Prodotti ORA', 'syncProdottiFromFIC')
      .addItem('📦 Importa Ordini Pending', 'processPendingOrders')
      .addSeparator()
      .addItem('📊 Mostra Log', 'showLogSheet')
      .addItem('🗑️ Pulisci Log', 'clearLogSheet')
      .addToUi();
    
    console.log('✅ Menu creato con successo');
    
    const props = PropertiesService.getDocumentProperties();
    const isFirstOpen = props.getProperty('first_open_shown') !== 'true';
    const isInstalled = props.getProperty('fic_sync_installed') === 'true';
    
    if (isInstalled && isFirstOpen) {
      Utilities.sleep(2000);
      props.setProperty('first_open_shown', 'true');
      
      ui.alert(
        '👋 Benvenuto!',
        'Fatture in Cloud Sync è pronto all\'uso.\n\n' +
        'Vai su Menu → ⚙️ Configura Credenziali per iniziare.\n\n' +
        '📖 Leggi il foglio "📖 ISTRUZIONI" per maggiori dettagli.',
        ui.ButtonSet.OK
      );
    }
    
  } catch (error) {
    console.error('❌ Errore creazione menu:', error.message);
    
    SpreadsheetApp.getUi()
      .createMenu('⚠️ FIC Sync')
      .addItem('🔧 Ripara Installazione', 'INSTALLA_FIC_SYNC')
      .addToUi();
  }
}

function setupInitialStructure() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  try {
    let configSheet = ss.getSheetByName('CONFIG');
    if (!configSheet) {
      configSheet = ss.insertSheet('CONFIG');
      
      configSheet.getRange('A1:C1').setValues([['Parametro', 'Valore', 'Descrizione']]);
      configSheet.getRange('A1:C1').setFontWeight('bold').setBackground('#cccccc');
      
      const params = [
        ['FIC_API_KEY', '', 'La tua API Key (verrà salvata in modo sicuro)'],
        ['FIC_COMPANY_ID', '', 'Il tuo Company ID (numero nell\'URL)'],
        ['SYNC_INTERVAL_HOURS', '1', 'Ore tra sincronizzazioni prodotti'],
        ['FIC_DOC_TYPE', 'invoice', 'Tipo: invoice, quote, proforma'],
        ['FIC_PAYMENT_METHOD_ID', '3', 'ID pagamento (3=Bonifico)'],
        ['FIC_PAYMENT_METHOD_NAME', 'Bonifico bancario', 'Nome metodo pagamento'],
        ['FIC_VAT_RATE', '22', 'Aliquota IVA predefinita (%)'],
        ['LOG_ENABLED', 'TRUE', 'Abilita logging (TRUE/FALSE)'],
        ['SHEET_ARTICOLI', 'ARTICOLI', 'Nome foglio prodotti'],
        ['SHEET_ORDINI', 'ORDINI', 'Nome foglio ordini']
      ];
      
      configSheet.getRange(2, 1, params.length, 3).setValues(params);
      
      configSheet.getRange('A2:A11').setFontWeight('bold');
      configSheet.getRange('B2:B11').setBackground('#fff9c4');
      configSheet.getRange('C2:C11').setFontColor('#666666');
      
      configSheet.setColumnWidth(1, 200);
      configSheet.setColumnWidth(2, 250);
      configSheet.setColumnWidth(3, 400);
    }
    
    const articoliSheet = ss.getSheetByName('ARTICOLI');
    if (articoliSheet) {
      const lastCol = articoliSheet.getLastColumn();
      if (lastCol >= 15) {
        const headers = articoliSheet.getRange(1, 15, 1, 3).getValues()[0];
        if (headers[0] !== 'FIC_ID') {
          articoliSheet.getRange(1, 15, 1, 3).setValues([['FIC_ID', 'FIC_CODE', 'LAST_SYNC']]);
          articoliSheet.getRange(1, 15, 1, 3).setFontWeight('bold').setBackground('#e3f2fd');
        }
      } else {
        articoliSheet.getRange(1, 15, 1, 3).setValues([['FIC_ID', 'FIC_CODE', 'LAST_SYNC']]);
        articoliSheet.getRange(1, 15, 1, 3).setFontWeight('bold').setBackground('#e3f2fd');
      }
    }
    
    const ordiniSheet = ss.getSheetByName('ORDINI');
    if (ordiniSheet) {
      const lastCol = ordiniSheet.getLastColumn();
      if (lastCol >= 15) {
        const headers = ordiniSheet.getRange(1, 15, 1, 5).getValues()[0];
        if (headers[0] !== 'FIC_STATUS') {
          ordiniSheet.getRange(1, 15, 1, 5).setValues([
            ['FIC_STATUS', 'FIC_DOC_ID', 'FIC_CLIENT_ID', 'FIC_ERROR', 'SYNC_DATE']
          ]);
          ordiniSheet.getRange(1, 15, 1, 5).setFontWeight('bold').setBackground('#fff3e0');
        }
      } else {
        ordiniSheet.getRange(1, 15, 1, 5).setValues([
          ['FIC_STATUS', 'FIC_DOC_ID', 'FIC_CLIENT_ID', 'FIC_ERROR', 'SYNC_DATE']
        ]);
        ordiniSheet.getRange(1, 15, 1, 5).setFontWeight('bold').setBackground('#fff3e0');
      }
    }
    
    let logSheet = ss.getSheetByName('LOG');
    if (!logSheet) {
      logSheet = ss.insertSheet('LOG');
      logSheet.getRange(1, 1, 1, 4).setValues([['Timestamp', 'Level', 'Message', 'Data']]);
      logSheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#cccccc');
      logSheet.setFrozenRows(1);
      logSheet.setColumnWidth(1, 180);
      logSheet.setColumnWidth(3, 300);
      logSheet.setColumnWidth(4, 400);
    }
    
    createInstructionsSheet();
    
    ui.alert('✅ Setup Completato!',
             'Struttura creata con successo.\n\n' +
             'Prossimi passi:\n' +
             '1. Menu > Configura Credenziali\n' +
             '2. Inserisci API Key e Company ID\n' +
             '3. Menu > Verifica Configurazione',
             ui.ButtonSet.OK);
    
  } catch (error) {
    ui.alert('❌ Errore Setup', error.message, ui.ButtonSet.OK);
  }
}

function createInstructionsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('📖 ISTRUZIONI');
  
  if (sheet) {
    return sheet;
  }
  
  sheet = ss.insertSheet('📖 ISTRUZIONI', 0);
  
  sheet.setColumnWidth(1, 900);
  sheet.setRowHeight(1, 50);
  
  const instructions = [
    ['🎉 BENVENUTO IN FATTURE IN CLOUD SYNC'],
    [''],
    ['Questa integrazione sincronizza automaticamente Store.link con Fatture in Cloud.'],
    [''],
    ['═══════════════════════════════════════════════════════════════════════════════'],
    [''],
    ['📋 CONFIGURAZIONE RAPIDA:'],
    [''],
    ['1. Menu → ⚙️ Configura Credenziali'],
    ['2. Inserisci API Key e Company ID (vedi sotto per ottenerle)'],
    ['3. Menu → ✅ Verifica Configurazione'],
    ['4. Menu → 🔄 Sincronizza Prodotti ORA (prima sincronizzazione)'],
    [''],
    ['═══════════════════════════════════════════════════════════════════════════════'],
    [''],
    ['🔑 COME OTTENERE LE CREDENZIALI FATTURE IN CLOUD:'],
    [''],
    ['A) API KEY:'],
    ['   1. Vai su https://secure.fattureincloud.it'],
    ['   2. Fai login con le tue credenziali'],
    ['   3. Clicca su Impostazioni (⚙️ in alto a destra)'],
    ['   4. Vai su "API e Applicazioni"'],
    ['   5. Nella sezione API Key, clicca "Genera nuova chiave"'],
    ['   6. ⚠️ COPIA IMMEDIATAMENTE la chiave (sarà visibile solo una volta!)'],
    ['   7. Conservala in un luogo sicuro'],
    [''],
    ['B) COMPANY ID:'],
    ['   1. Mentre sei loggato in Fatture in Cloud'],
    ['   2. Guarda l\'URL nella barra del browser'],
    ['   3. Cerca questo pattern: https://secure.fattureincloud.it/c/12345/home'],
    ['   4. Il numero dopo "/c/" è il tuo Company ID (esempio: 12345)'],
    ['   5. Copia solo il numero'],
    [''],
    ['═══════════════════════════════════════════════════════════════════════════════'],
    [''],
    ['📊 COME FUNZIONA LA SINCRONIZZAZIONE:'],
    [''],
    ['PRODOTTI (da Fatture in Cloud → Foglio ARTICOLI):'],
    ['   • Automatica ogni ora (configurabile nel foglio CONFIG)'],
    ['   • Oppure manuale: Menu → 🔄 Sincronizza Prodotti ORA'],
    ['   • Importa: nome, prezzo, descrizione, giacenza, codice'],
    [''],
    ['ORDINI (da Foglio ORDINI → Fatture in Cloud):'],
    ['   • Automatica quando inserisci una nuova riga nel foglio ORDINI'],
    ['   • Crea automaticamente il cliente (se non esiste)'],
    ['   • Crea il documento (fattura/preventivo)'],
    ['   • Stato sincronizzazione nella colonna FIC_STATUS'],
    [''],
    ['═══════════════════════════════════════════════════════════════════════════════'],
    [''],
    ['🛠️ RISOLUZIONE PROBLEMI:'],
    [''],
    ['PROBLEMA: Errore "API Key non valida"'],
    ['   → Verifica di aver copiato l\'intera API Key (circa 60 caratteri)'],
    ['   → Genera una nuova API Key da Fatture in Cloud'],
    ['   → Menu → ⚙️ Configura Credenziali (inserisci la nuova chiave)'],
    [''],
    ['PROBLEMA: Ordini con stato ERROR'],
    ['   → Controlla la colonna FIC_ERROR per il messaggio di errore'],
    ['   → Verifica che l\'email del cliente sia valida'],
    ['   → Verifica che i prodotti esistano nel foglio ARTICOLI'],
    ['   → Correggi i dati e cambia FIC_STATUS da ERROR a vuoto'],
    ['   → Menu → 📦 Importa Ordini Pending'],
    [''],
    ['PROBLEMA: Prodotti non sincronizzati'],
    ['   → Menu → 🔄 Sincronizza Prodotti ORA'],
    ['   → Controlla il foglio LOG per eventuali errori'],
    ['   → Verifica la connessione: Menu → ✅ Verifica Configurazione'],
    [''],
    ['═══════════════════════════════════════════════════════════════════════════════'],
    [''],
    ['⚠️ NOTE IMPORTANTI SULLA SICUREZZA:'],
    [''],
    ['   • L\'API Key è criptata e salvata in modo sicuro'],
    ['   • NON condividere mai la tua API Key con altri'],
    ['   • NON pubblicare screenshot del foglio CONFIG con credenziali visibili'],
    ['   • Cambia l\'API Key ogni 6 mesi per maggiore sicurezza'],
    [''],
    ['═══════════════════════════════════════════════════════════════════════════════'],
    [''],
    ['Versione: 1.0.0 | © 2025 Fatture in Cloud Sync'],
    ['']
  ];
  
  sheet.getRange(1, 1, instructions.length, 1).setValues(instructions);
  
  sheet.getRange('A1').setFontSize(18).setFontWeight('bold')
    .setBackground('#4285f4').setFontColor('#ffffff')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  
  const sectionRows = [7, 16, 34, 48];
  sectionRows.forEach(row => {
    sheet.getRange(row, 1).setFontSize(13).setFontWeight('bold')
      .setBackground('#f1f3f4');
  });
  
  const protection = sheet.protect();
  protection.setDescription('Foglio istruzioni protetto');
  protection.setWarningOnly(true);
  
  console.log('✅ Foglio ISTRUZIONI creato');
  
  return sheet;
}

function showSetupGuide() {
  const html = HtmlService.createHtmlOutput(getSetupGuideHTML())
    .setWidth(700)
    .setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, '📚 Guida Setup Fatture in Cloud Sync');
}

function showConfigDialog() {
  const html = HtmlService.createHtmlOutput(getConfigDialogHTML())
    .setWidth(650)
    .setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, '⚙️ Configurazione Sicura');
}

function testConfiguration() {
  const ui = SpreadsheetApp.getUi();

  try {
    const validation = validateConfig();
    
    if (!validation.valid) {
      ui.alert('⚠️ Configurazione Incompleta',
               validation.errors.join('\n'),
               ui.ButtonSet.OK);
      return;
    }
    
    const api = new FattureInCloudAPI();
    const response = api.testConnection();
    
    if (response.success) {
      ui.alert('✅ Configurazione OK!',
               `Connessione a Fatture in Cloud riuscita.\n\n` +
               `Company ID: ${CONFIG.FIC_COMPANY_ID}\n` +
               `API Key: ${security.maskApiKey(CONFIG.FIC_API_KEY)}`,
               ui.ButtonSet.OK);
    } else {
      throw new Error(response.message);
    }
    
  } catch (error) {
    ui.alert('❌ Errore Configurazione',
             `Impossibile connettersi.\n\nErrore: ${error.message}\n\n` +
             'Verifica API Key e Company ID',
             ui.ButtonSet.OK);
  }
}

function showLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName('LOG');

  if (logSheet) {
    ss.setActiveSheet(logSheet);
  } else {
    SpreadsheetApp.getUi().alert('Foglio LOG non trovato');
  }
}

function clearLogSheet() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert('Conferma',
                            'Vuoi cancellare tutti i log?',
                            ui.ButtonSet.YES_NO);

  if (response === ui.Button.YES) {
    const logSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('LOG');
    if (logSheet && logSheet.getLastRow() > 1) {
      logSheet.getRange(2, 1, logSheet.getLastRow() - 1, 4).clear();
      ui.alert('✅ Log cancellati');
    }
  }
}

function INSTALLA_FIC_SYNC() {
  const ui = SpreadsheetApp.getUi();
  
  const response = ui.alert(
    '🎉 Benvenuto in Fatture in Cloud Sync!',
    'Questa procedura installerà automaticamente:\n\n' +
    '✓ Menu di sincronizzazione\n' +
    '✓ Fogli di configurazione (CONFIG, LOG)\n' +
    '✓ Trigger automatici\n' +
    '✓ Colonne necessarie nei fogli ARTICOLI e ORDINI\n' +
    '✓ Foglio istruzioni\n\n' +
    'L\'installazione richiede circa 30 secondi.\n\n' +
    'Vuoi procedere?',
    ui.ButtonSet.YES_NO
  );
  
  if (response !== ui.Button.YES) {
    ui.alert('Installazione annullata.');
    return;
  }
  
  try {
    ui.alert('⏳ Installazione...', 'STEP 1/4: Installazione trigger automatico', ui.ButtonSet.OK);
    installTrigger();
    
    ui.alert('⏳ Installazione...', 'STEP 2/4: Creazione fogli di sistema', ui.ButtonSet.OK);
    setupInitialStructure();
    
    ui.alert('⏳ Installazione...', 'STEP 3/4: Creazione menu', ui.ButtonSet.OK);
    onOpen();
    
    const props = PropertiesService.getDocumentProperties();
    props.setProperty('fic_sync_installed', 'true');
    props.setProperty('install_date', new Date().toISOString());
    
    ui.alert(
      '✅ Installazione Completata!',
      'Fatture in Cloud Sync è stato installato con successo!\n\n' +
      '📋 PROSSIMI PASSI:\n\n' +
      '1. Vai al foglio CONFIG (o chiudi questo messaggio)\n' +
      '2. Clicca su Menu → ⚙️ Configura Credenziali\n' +
      '3. Inserisci API Key e Company ID di Fatture in Cloud\n' +
      '4. Clicca Menu → ✅ Verifica Configurazione\n\n' +
      '📚 Leggi il foglio "📖 ISTRUZIONI" per dettagli su come ottenere le credenziali.\n\n' +
      '⚠️ IMPORTANTE: Ricarica la pagina (F5) per vedere il menu in alto!',
      ui.ButtonSet.OK
    );
    
    const instructionsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('📖 ISTRUZIONI');
    if (instructionsSheet) {
      SpreadsheetApp.setActiveSheet(instructionsSheet);
    }
    
  } catch (error) {
    ui.alert(
      '❌ Errore Installazione',
      'Si è verificato un errore durante l\'installazione:\n\n' + error.message + '\n\n' +
      'Possibili soluzioni:\n' +
      '• Riprova eseguendo di nuovo INSTALLA_FIC_SYNC\n' +
      '• Verifica di avere i permessi di modifica sul foglio\n' +
      '• Contatta il supporto se il problema persiste',
      ui.ButtonSet.OK
    );
    
    console.error('Errore installazione:', error);
  }
}

function installTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  const triggers = ScriptApp.getUserTriggers(ss);
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'onOpen') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  ScriptApp.newTrigger('onOpen')
    .forSpreadsheet(ss)
    .onOpen()
    .create();
  
  console.log('✅ Trigger onOpen installato');
}

// ============================================
// HTML CONTENT (come stringhe)
// ============================================

function getConfigDialogHTML() {
  return `<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: 'Google Sans', Arial, sans-serif; 
      padding: 24px; 
      background: #f8f9fa;
    }
    .container { 
      max-width: 600px; 
      margin: 0 auto; 
      background: white; 
      padding: 32px; 
      border-radius: 12px; 
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    h2 { 
      color: #1a73e8; 
      margin-bottom: 24px;
      font-size: 24px;
    }
    .form-group { margin-bottom: 20px; }
    label { 
      display: block; 
      font-weight: 500; 
      margin-bottom: 8px; 
      color: #202124;
      font-size: 14px;
    }
    input { 
      width: 100%; 
      padding: 12px; 
      border: 1px solid #dadce0; 
      border-radius: 6px; 
      font-size: 14px;
      font-family: inherit;
    }
    input:focus { 
      outline: none; 
      border-color: #1a73e8; 
      box-shadow: 0 0 0 3px rgba(26,115,232,0.1);
    }
    .help-text { 
      font-size: 12px; 
      color: #5f6368; 
      margin-top: 6px;
      line-height: 1.5;
    }
    .help-text a {
      color: #1a73e8;
      text-decoration: none;
    }
    .help-text a:hover {
      text-decoration: underline;
    }
    .button { 
      background: #1a73e8; 
      color: white; 
      border: none; 
      padding: 12px 24px; 
      border-radius: 6px; 
      cursor: pointer; 
      font-size: 14px; 
      font-weight: 500;
      margin-right: 10px;
      transition: background 0.2s;
    }
    .button:hover { background: #1557b0; }
    .button:disabled {
      background: #dadce0;
      cursor: not-allowed;
    }
    .button-secondary { 
      background: white; 
      color: #1a73e8; 
      border: 1px solid #dadce0; 
    }
    .button-secondary:hover { 
      background: #f8f9fa; 
      border-color: #1a73e8;
    }
    .alert { 
      padding: 12px 16px; 
      border-radius: 6px; 
      margin: 16px 0; 
      display: none;
      font-size: 14px;
    }
    .alert-success { 
      background: #e8f5e9; 
      color: #1b5e20; 
      border: 1px solid #c8e6c9; 
    }
    .alert-error { 
      background: #ffebee; 
      color: #c62828; 
      border: 1px solid #ef9a9a; 
    }
    .alert-warning {
      background: #fff3e0;
      color: #e65100;
      border: 1px solid #ffe0b2;
    }
    .security-notice {
      background: #e3f2fd;
      padding: 16px;
      border-radius: 6px;
      margin: 20px 0;
      border-left: 4px solid #1a73e8;
    }
    .security-notice h4 {
      color: #1a73e8;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .security-notice p {
      color: #5f6368;
      font-size: 13px;
      line-height: 1.5;
    }
    .button-group {
      display: flex;
      gap: 10px;
      margin-top: 24px;
    }
    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid #f3f3f3;
      border-top: 2px solid #1a73e8;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-left: 8px;
      display: inline-block;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>

<div class="container">
  <h2>🔐 Configurazione Sicura Fatture in Cloud</h2>

  <div id="alertBox" class="alert"></div>

  <div class="security-notice">
    <h4>🛡️ Sicurezza delle Credenziali</h4>
    <p>
      Le tue credenziali saranno salvate in modo <strong>criptato</strong> utilizzando 
      PropertiesService di Google. Non saranno mai visibili nel codice o nei log.
    </p>
  </div>

  <form id="configForm">
    <div class="form-group">
      <label for="apiKey">API Key * 🔑</label>/**
 * ════════════════════════════════════════════════════════════════════
 * FATTURE IN CLOUD SYNC - IMPORT AUTOMATICO
 * ════════════════════════════════════════════════════════════════════
 * 
 * 📥 ISTRUZIONI PER L'UTENTE:
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
 * ✅ Fatto! Il menu "🔄 Sync Fatture in Cloud" apparirà!
 * 
 * ════════════════════════════════════════════════════════════════════
 */

// ⚠️ MODIFICA QUESTO URL CON IL TUO!
const CODE_SOURCE_URL = 'https://raw.githubusercontent.com/TUO_USERNAME/fic-sync-storelink/main/FICSync_Complete.js';

function IMPORTA_FIC_SYNC() {
  const ui = SpreadsheetApp.getUi();
  
  const response = ui.alert(
    '🚀 Import Fatture in Cloud Sync',
    'Questa procedura:\n\n' +
    '✓ Scaricherà il codice completo dal server\n' +
    '✓ Installerà tutti i moduli necessari\n' +
    '✓ Creerà i fogli di configurazione\n' +
    '✓ Installerà i trigger automatici\n\n' +
    'Tempo stimato: 30-60 secondi\n\n' +
    'Vuoi procedere?',
    ui.ButtonSet.YES_NO
  );
  
  if (response !== ui.Button.YES) {
    ui.alert('Import annullato.');
    return;
  }
  
  try {
    ui.alert('📥 Download...', 'Scaricamento codice dal server...', ui.ButtonSet.OK);
    const code = downloadCode();
    
    ui.alert('⚙️ Installazione...', 'Installazione moduli...', ui.ButtonSet.OK);
    eval(code);
    
    ui.alert('🔧 Configurazione...', 'Creazione fogli e trigger...', ui.ButtonSet.OK);
    Utilities.sleep(2000);
    
    if (typeof INSTALLA_FIC_SYNC === 'function') {
      INSTALLA_FIC_SYNC();
    } else {
      throw new Error('Funzione INSTALLA_FIC_SYNC non trovata dopo import');
    }
    
  } catch (error) {
    ui.alert(
      '❌ Errore Import',
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
    
    console.log('✅ Codice scaricato: ' + code.length + ' caratteri');
    return code;
    
  } catch (error) {
    throw new Error('Impossibile scaricare il codice: ' + error.message);
  }
}
