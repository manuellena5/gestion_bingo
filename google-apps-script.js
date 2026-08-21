// =====================================================
// GOOGLE APPS SCRIPT - Backend Bingo Club
// =====================================================
// INSTRUCCIONES:
// 1. Abri https://script.google.com y crea un nuevo proyecto
// 2. Pega este codigo completo reemplazando todo lo existente
// 3. Crea un Google Sheet nuevo y copia su ID en SPREADSHEET_ID
// 4. Deploy > New deployment > Web app
//    - Execute as: Me
//    - Who has access: Anyone
// 5. Copia la URL del deployment y pegala en la webapp
// =====================================================

const SPREADSHEET_ID = 'PEGA_TU_ID_AQUI';
const SHEET_VENDEDORES = 'Vendedores';
const SHEET_BINGOS = 'Bingos';
const SHEET_COBROS = 'Cobros';

// ============ HELPERS ============

function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = data[i][j];
    }
    obj._row = i + 1;
    rows.push(obj);
  }
  return rows;
}

// ============ GET ============

function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === 'getAll') return getAll();
    return jsonResponse({ status: 'error', message: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

function getAll() {
  // Vendedores
  const vendedoresSheet = getOrCreateSheet(SHEET_VENDEDORES, ['Nombre']);
  const vendedoresRaw = sheetToObjects(vendedoresSheet);
  const vendedores = vendedoresRaw.map(v => ({ nombre: v['Nombre'] }));

  // Bingos
  const bingosSheet = getOrCreateSheet(SHEET_BINGOS, ['Vendedor', 'NroBingo', 'Comprador']);
  const bingosRaw = sheetToObjects(bingosSheet);

  // Cobros
  const cobrosSheet = getOrCreateSheet(SHEET_COBROS, ['Vendedor', 'NroBingo', 'Comprador', 'NroCuota', 'Monto', 'MetodoPago', 'Fecha']);
  const cobrosRaw = sheetToObjects(cobrosSheet);

  // Build bingos with cuotas
  const bingos = bingosRaw.map(b => {
    const cuotas = cobrosRaw
      .filter(c => c['Vendedor'] === b['Vendedor'] && Number(c['NroBingo']) === Number(b['NroBingo']))
      .map(c => ({
        nro: Number(c['NroCuota']),
        monto: Number(c['Monto']),
        metodo: c['MetodoPago'],
        fecha: c['Fecha']
      }));
    return {
      vendedor: b['Vendedor'],
      nroBingo: Number(b['NroBingo']),
      comprador: b['Comprador'],
      cuotas
    };
  });

  return jsonResponse({ status: 'ok', vendedores, bingos });
}

// ============ POST ============

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    if (action === 'addVendedor') return addVendedor(data);
    if (action === 'deleteVendedor') return deleteVendedor(data);
    if (action === 'addBingo') return addBingo(data);
    if (action === 'updateBingo') return updateBingo(data);
    if (action === 'deleteBingo') return deleteBingo(data);
    if (action === 'registrarCobro') return registrarCobro(data);

    return jsonResponse({ status: 'error', message: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

// --- Vendedores ---
function addVendedor(data) {
  const sheet = getOrCreateSheet(SHEET_VENDEDORES, ['Nombre']);
  sheet.appendRow([data.nombre]);
  return jsonResponse({ status: 'ok', message: 'Vendedor agregado' });
}

function deleteVendedor(data) {
  const nombre = data.nombre;

  // Delete from Vendedores sheet
  const vSheet = getOrCreateSheet(SHEET_VENDEDORES, ['Nombre']);
  const vData = vSheet.getDataRange().getValues();
  for (let i = vData.length - 1; i >= 1; i--) {
    if (vData[i][0] === nombre) {
      vSheet.deleteRow(i + 1);
    }
  }

  // Delete bingos of this vendor
  const bSheet = getOrCreateSheet(SHEET_BINGOS, ['Vendedor', 'NroBingo', 'Comprador']);
  const bData = bSheet.getDataRange().getValues();
  for (let i = bData.length - 1; i >= 1; i--) {
    if (bData[i][0] === nombre) {
      bSheet.deleteRow(i + 1);
    }
  }

  // Delete cobros of this vendor
  const cSheet = getOrCreateSheet(SHEET_COBROS, ['Vendedor', 'NroBingo', 'Comprador', 'NroCuota', 'Monto', 'MetodoPago', 'Fecha']);
  const cData = cSheet.getDataRange().getValues();
  for (let i = cData.length - 1; i >= 1; i--) {
    if (cData[i][0] === nombre) {
      cSheet.deleteRow(i + 1);
    }
  }

  return jsonResponse({ status: 'ok', message: 'Vendedor eliminado' });
}

// --- Bingos ---
function addBingo(data) {
  const sheet = getOrCreateSheet(SHEET_BINGOS, ['Vendedor', 'NroBingo', 'Comprador']);
  sheet.appendRow([data.vendedor, data.nroBingo, data.comprador]);
  return jsonResponse({ status: 'ok', message: 'Bingo agregado' });
}

// Cambia el numero y/o el comprador de un bingo.
// OJO: NroBingo es la clave con la que se unen las hojas Bingos y Cobros,
// asi que hay que actualizar TAMBIEN todas las filas de Cobros del bingo,
// sino los cobros ya registrados quedan huerfanos.
// data: { vendedor, nroBingoOriginal, nroBingo, comprador }
function updateBingo(data) {
  const nroViejo = Number(data.nroBingoOriginal);
  const nroNuevo = Number(data.nroBingo);
  const comprador = data.comprador;

  const bSheet = getOrCreateSheet(SHEET_BINGOS, ['Vendedor', 'NroBingo', 'Comprador']);
  const bData = bSheet.getDataRange().getValues();

  // Validacion server-side: el numero nuevo no puede estar tomado por OTRO bingo.
  if (nroNuevo !== nroViejo) {
    for (let i = 1; i < bData.length; i++) {
      if (Number(bData[i][1]) === nroNuevo) {
        return jsonResponse({ status: 'error', message: 'El numero ' + nroNuevo + ' ya esta asignado' });
      }
    }
  }

  let encontrado = false;
  for (let i = 1; i < bData.length; i++) {
    if (bData[i][0] === data.vendedor && Number(bData[i][1]) === nroViejo) {
      bSheet.getRange(i + 1, 2).setValue(nroNuevo);
      bSheet.getRange(i + 1, 3).setValue(comprador);
      encontrado = true;
    }
  }
  if (!encontrado) {
    return jsonResponse({ status: 'error', message: 'No se encontro el bingo ' + nroViejo });
  }

  // Propagar a los cobros ya registrados
  const cSheet = getOrCreateSheet(SHEET_COBROS, ['Vendedor', 'NroBingo', 'Comprador', 'NroCuota', 'Monto', 'MetodoPago', 'Fecha']);
  const cData = cSheet.getDataRange().getValues();
  let cobrosActualizados = 0;
  for (let i = 1; i < cData.length; i++) {
    if (cData[i][0] === data.vendedor && Number(cData[i][1]) === nroViejo) {
      cSheet.getRange(i + 1, 2).setValue(nroNuevo);
      cSheet.getRange(i + 1, 3).setValue(comprador);
      cobrosActualizados++;
    }
  }

  return jsonResponse({
    status: 'ok',
    message: 'Bingo actualizado',
    cobrosActualizados: cobrosActualizados
  });
}

function deleteBingo(data) {
  // Delete from Bingos
  const bSheet = getOrCreateSheet(SHEET_BINGOS, ['Vendedor', 'NroBingo', 'Comprador']);
  const bData = bSheet.getDataRange().getValues();
  for (let i = bData.length - 1; i >= 1; i--) {
    if (bData[i][0] === data.vendedor && Number(bData[i][1]) === Number(data.nroBingo)) {
      bSheet.deleteRow(i + 1);
    }
  }

  // Delete associated cobros
  const cSheet = getOrCreateSheet(SHEET_COBROS, ['Vendedor', 'NroBingo', 'Comprador', 'NroCuota', 'Monto', 'MetodoPago', 'Fecha']);
  const cData = cSheet.getDataRange().getValues();
  for (let i = cData.length - 1; i >= 1; i--) {
    if (cData[i][0] === data.vendedor && Number(cData[i][1]) === Number(data.nroBingo)) {
      cSheet.deleteRow(i + 1);
    }
  }

  return jsonResponse({ status: 'ok', message: 'Bingo eliminado' });
}

// --- Cobros ---
function registrarCobro(data) {
  const sheet = getOrCreateSheet(SHEET_COBROS, ['Vendedor', 'NroBingo', 'Comprador', 'NroCuota', 'Monto', 'MetodoPago', 'Fecha']);

  // La webapp manda data.fecha como timestamp ISO (fecha + hora).
  // Se guarda como Date real para que la planilla ordene y filtre bien,
  // y para que getAll() lo devuelva con la hora incluida.
  let fecha = new Date();
  if (data.fecha) {
    const parsed = new Date(data.fecha);
    if (!isNaN(parsed.getTime())) fecha = parsed;
  }

  // data.cuotas is an array of cuota numbers
  const cuotas = data.cuotas || [];
  cuotas.forEach(nroCuota => {
    sheet.appendRow([
      data.vendedor,
      data.nroBingo,
      data.comprador,
      nroCuota,
      data.montoPorCuota || 10000,
      data.metodo || 'Efectivo',
      fecha
    ]);
    // Formato visible dd/mm/aaaa hh:mm en la columna Fecha (col 7)
    sheet.getRange(sheet.getLastRow(), 7).setNumberFormat('dd/mm/yyyy hh:mm');
  });

  return jsonResponse({ status: 'ok', message: 'Cobro registrado' });
}

// ============ JSON Response ============
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
