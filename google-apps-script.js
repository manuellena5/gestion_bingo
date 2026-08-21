// =====================================================
// GOOGLE APPS SCRIPT - Backend Bingo Club
// =====================================================
// INSTRUCCIONES:
// 1. Abri https://script.google.com y pega este codigo reemplazando todo
// 2. Verifica que SPREADSHEET_ID apunte a la planilla correcta
// 3. Deploy > Administrar implementaciones > editar > Nueva version
//    - Ejecutar como: Yo
//    - Quien tiene acceso: Cualquier persona
//
// ESQUEMA CON IDs
// ---------------
// El ID es el vinculo real entre hojas. Las columnas de texto (Vendedor,
// Comprador, NroBingo) son COPIAS LEGIBLES para poder leer la planilla a ojo.
// Al renombrar algo, el texto se reescribe en cascada buscando por ID.
//
//   Vendedores: Nombre | IdVendedor
//   Bingos:     Vendedor | NroBingo | Comprador | IdBingo | IdVendedor
//   Cobros:     Vendedor | NroBingo | Comprador | NroCuota | Monto |
//               MetodoPago | Fecha | IdBingo | IdVendedor
//
// Las columnas de ID se agregan AL FINAL a proposito: asi una planilla vieja
// no se rompe y las formulas o filtros que hubiera siguen apuntando a lo mismo.
// ensureSchema_() las crea y las completa solo la primera vez.
// =====================================================

const SPREADSHEET_ID = 'PEGA_TU_ID_AQUI';
const SHEET_VENDEDORES = 'Vendedores';
const SHEET_BINGOS = 'Bingos';
const SHEET_COBROS = 'Cobros';

const COLS_VENDEDORES = ['Nombre', 'IdVendedor'];
const COLS_BINGOS = ['Vendedor', 'NroBingo', 'Comprador', 'IdBingo', 'IdVendedor'];
const COLS_COBROS = ['Vendedor', 'NroBingo', 'Comprador', 'NroCuota', 'Monto', 'MetodoPago', 'Fecha', 'IdBingo', 'IdVendedor'];

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

// Indice 1-based de una columna por nombre de encabezado. 0 si no existe.
function colIndex_(sheet, nombre) {
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === nombre) return i + 1;
  }
  return 0;
}

// Se asegura de que existan las columnas pedidas; las que falten se agregan al final.
function asegurarColumnas_(sheet, columnas) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(columnas);
    sheet.getRange(1, 1, 1, columnas.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return;
  }
  columnas.forEach(function (c) {
    if (colIndex_(sheet, c) === 0) {
      const nueva = sheet.getLastColumn() + 1;
      sheet.getRange(1, nueva).setValue(c).setFontWeight('bold');
    }
  });
}

// Normaliza un nombre para comparar: sin acentos, sin espacios de mas, minusculas.
function norm_(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase().replace(/\s+/g, ' ');
}

// Genera el proximo ID libre con prefijo y padding: V001, B0001...
function proximoId_(existentes, prefijo, padding) {
  let max = 0;
  existentes.forEach(function (id) {
    const m = String(id || '').match(new RegExp('^' + prefijo + '(\\d+)$'));
    if (m) max = Math.max(max, Number(m[1]));
  });
  let n = max + 1;
  return prefijo + String(n).padStart(padding, '0');
}

// ============ MIGRACION / BACKFILL ============
// Crea las columnas de ID si faltan y completa las filas que esten vacias.
// Es idempotente: si ya esta todo migrado no escribe nada.
function ensureSchema_() {
  const vSheet = getOrCreateSheet(SHEET_VENDEDORES, COLS_VENDEDORES);
  const bSheet = getOrCreateSheet(SHEET_BINGOS, COLS_BINGOS);
  const cSheet = getOrCreateSheet(SHEET_COBROS, COLS_COBROS);
  asegurarColumnas_(vSheet, COLS_VENDEDORES);
  asegurarColumnas_(bSheet, COLS_BINGOS);
  asegurarColumnas_(cSheet, COLS_COBROS);

  const resultado = { vendedores: 0, bingos: 0, cobros: 0 };

  // --- 1. Vendedores sin IdVendedor
  const vIdCol = colIndex_(vSheet, 'IdVendedor');
  const vendedores = sheetToObjects(vSheet);
  const idsV = vendedores.map(function (v) { return v['IdVendedor']; }).filter(String);
  const mapaVendedorPorNombre = {};

  vendedores.forEach(function (v) {
    let id = String(v['IdVendedor'] || '').trim();
    if (!id) {
      id = proximoId_(idsV, 'V', 3);
      idsV.push(id);
      vSheet.getRange(v._row, vIdCol).setValue(id);
      resultado.vendedores++;
    }
    mapaVendedorPorNombre[norm_(v['Nombre'])] = id;
  });

  // --- 2. Bingos sin IdBingo / IdVendedor
  const bIdCol = colIndex_(bSheet, 'IdBingo');
  const bIdVCol = colIndex_(bSheet, 'IdVendedor');
  const bingos = sheetToObjects(bSheet);
  const idsB = bingos.map(function (b) { return b['IdBingo']; }).filter(String);
  // clave "vendedor|nro" -> IdBingo, para poder adoptar los cobros viejos
  const mapaBingo = {};

  bingos.forEach(function (b) {
    let id = String(b['IdBingo'] || '').trim();
    if (!id) {
      id = proximoId_(idsB, 'B', 4);
      idsB.push(id);
      bSheet.getRange(b._row, bIdCol).setValue(id);
      resultado.bingos++;
    }
    let idv = String(b['IdVendedor'] || '').trim();
    if (!idv) {
      idv = mapaVendedorPorNombre[norm_(b['Vendedor'])] || '';
      if (idv) bSheet.getRange(b._row, bIdVCol).setValue(idv);
    }
    mapaBingo[norm_(b['Vendedor']) + '|' + Number(b['NroBingo'])] = { idBingo: id, idVendedor: idv };
  });

  // --- 3. Cobros sin IdBingo / IdVendedor: se adoptan matcheando vendedor + nro
  const cIdCol = colIndex_(cSheet, 'IdBingo');
  const cIdVCol = colIndex_(cSheet, 'IdVendedor');
  const cobros = sheetToObjects(cSheet);

  cobros.forEach(function (c) {
    const tieneB = String(c['IdBingo'] || '').trim();
    const tieneV = String(c['IdVendedor'] || '').trim();
    if (tieneB && tieneV) return;
    const ref = mapaBingo[norm_(c['Vendedor']) + '|' + Number(c['NroBingo'])];
    if (!ref) return; // cobro huerfano: lo reporta checkFks, no lo inventamos
    if (!tieneB && ref.idBingo) cSheet.getRange(c._row, cIdCol).setValue(ref.idBingo);
    if (!tieneV && ref.idVendedor) cSheet.getRange(c._row, cIdVCol).setValue(ref.idVendedor);
    resultado.cobros++;
  });

  return resultado;
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
  ensureSchema_();

  const vendedoresSheet = getOrCreateSheet(SHEET_VENDEDORES, COLS_VENDEDORES);
  const vendedores = sheetToObjects(vendedoresSheet).map(function (v) {
    return { id: String(v['IdVendedor'] || ''), nombre: v['Nombre'] };
  });

  const bingosSheet = getOrCreateSheet(SHEET_BINGOS, COLS_BINGOS);
  const bingosRaw = sheetToObjects(bingosSheet);

  const cobrosSheet = getOrCreateSheet(SHEET_COBROS, COLS_COBROS);
  const cobrosRaw = sheetToObjects(cobrosSheet);

  // El join ahora es por IdBingo. Si algun cobro viejo quedo sin ID (no se pudo
  // adoptar en el backfill) se cae al criterio anterior para no perderlo.
  const bingos = bingosRaw.map(function (b) {
    const idBingo = String(b['IdBingo'] || '');
    const cuotas = cobrosRaw
      .filter(function (c) {
        const cid = String(c['IdBingo'] || '');
        if (cid && idBingo) return cid === idBingo;
        return c['Vendedor'] === b['Vendedor'] && Number(c['NroBingo']) === Number(b['NroBingo']);
      })
      .map(function (c) {
        return {
          nro: Number(c['NroCuota']),
          monto: Number(c['Monto']),
          metodo: c['MetodoPago'],
          fecha: c['Fecha']
        };
      });
    return {
      id: idBingo,
      idVendedor: String(b['IdVendedor'] || ''),
      vendedor: b['Vendedor'],
      nroBingo: Number(b['NroBingo']),
      comprador: b['Comprador'],
      cuotas: cuotas
    };
  });

  return jsonResponse({ status: 'ok', vendedores: vendedores, bingos: bingos });
}

// ============ POST ============

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    if (action === 'addVendedor') return addVendedor(data);
    if (action === 'updateVendedor') return updateVendedor(data);
    if (action === 'deleteVendedor') return deleteVendedor(data);
    if (action === 'addBingo') return addBingo(data);
    if (action === 'updateBingo') return updateBingo(data);
    if (action === 'deleteBingo') return deleteBingo(data);
    if (action === 'registrarCobro') return registrarCobro(data);
    if (action === 'backfillIds') return jsonResponse({ status: 'ok', backfill: ensureSchema_() });
    if (action === 'checkFks') return checkFks();

    return jsonResponse({ status: 'error', message: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

// --- Vendedores ---
function addVendedor(data) {
  ensureSchema_();
  const sheet = getOrCreateSheet(SHEET_VENDEDORES, COLS_VENDEDORES);
  const existentes = sheetToObjects(sheet);

  // El ID lo propone la app (no puede leer la respuesta por el modo no-cors).
  // Si ya esta tomado, aca se le asigna el proximo libre y la app se autocorrige
  // en la siguiente recarga, que es cuando la planilla vuelve a ser la verdad.
  let id = String(data.idVendedor || '').trim();
  const tomados = existentes.map(function (v) { return String(v['IdVendedor'] || ''); });
  if (!id || tomados.indexOf(id) !== -1) id = proximoId_(tomados, 'V', 3);

  const cols = {};
  COLS_VENDEDORES.forEach(function (c) { cols[c] = colIndex_(sheet, c); });
  const fila = sheet.getLastRow() + 1;
  sheet.getRange(fila, cols['Nombre']).setValue(data.nombre);
  sheet.getRange(fila, cols['IdVendedor']).setValue(id);

  return jsonResponse({ status: 'ok', message: 'Vendedor agregado', idVendedor: id });
}

// Renombra un vendedor y reescribe la copia legible del nombre en Bingos y
// Cobros. La busqueda es POR ID: por eso el rename no rompe ningun vinculo.
// data: { idVendedor, nombre }
function updateVendedor(data) {
  ensureSchema_();
  const id = String(data.idVendedor || '').trim();
  const nombre = data.nombre;
  if (!id) return jsonResponse({ status: 'error', message: 'Falta idVendedor' });

  const vSheet = getOrCreateSheet(SHEET_VENDEDORES, COLS_VENDEDORES);
  const vNomCol = colIndex_(vSheet, 'Nombre');
  const vIdCol = colIndex_(vSheet, 'IdVendedor');
  const vendedores = sheetToObjects(vSheet);

  // No permitir dos vendedores con el mismo nombre
  const choca = vendedores.some(function (v) {
    return String(v['IdVendedor']) !== id && norm_(v['Nombre']) === norm_(nombre);
  });
  if (choca) return jsonResponse({ status: 'error', message: 'Ya existe un vendedor con ese nombre' });

  let encontrado = false;
  vendedores.forEach(function (v) {
    if (String(v['IdVendedor']) === id) {
      vSheet.getRange(v._row, vNomCol).setValue(nombre);
      encontrado = true;
    }
  });
  if (!encontrado) return jsonResponse({ status: 'error', message: 'No se encontro el vendedor ' + id });

  const tocados = { bingos: 0, cobros: 0 };
  tocados.bingos = cascadeNombre_(SHEET_BINGOS, COLS_BINGOS, 'IdVendedor', 'Vendedor', id, nombre);
  tocados.cobros = cascadeNombre_(SHEET_COBROS, COLS_COBROS, 'IdVendedor', 'Vendedor', id, nombre);

  return jsonResponse({ status: 'ok', message: 'Vendedor actualizado', tocados: tocados });
}

// Reescribe colNombre en todas las filas cuyo colId coincide. Devuelve cuantas toco.
function cascadeNombre_(nombreHoja, columnas, colId, colNombre, id, nuevoNombre) {
  const sheet = getOrCreateSheet(nombreHoja, columnas);
  const iId = colIndex_(sheet, colId);
  const iNom = colIndex_(sheet, colNombre);
  if (!iId || !iNom) return 0;
  const filas = sheetToObjects(sheet);
  let n = 0;
  filas.forEach(function (f) {
    if (String(f[colId] || '') === id && f[colNombre] !== nuevoNombre) {
      sheet.getRange(f._row, iNom).setValue(nuevoNombre);
      n++;
    }
  });
  return n;
}

function deleteVendedor(data) {
  ensureSchema_();
  const id = String(data.idVendedor || '').trim();
  const nombre = data.nombre;
  // Coincide si el ID es igual, o (para filas viejas sin ID) si coincide el nombre
  const coincide = function (filaId, filaNombre) {
    if (id && String(filaId || '') === id) return true;
    if (!String(filaId || '') && nombre) return norm_(filaNombre) === norm_(nombre);
    return false;
  };

  const vSheet = getOrCreateSheet(SHEET_VENDEDORES, COLS_VENDEDORES);
  const vIdCol = colIndex_(vSheet, 'IdVendedor');
  const vNomCol = colIndex_(vSheet, 'Nombre');
  const vData = vSheet.getDataRange().getValues();
  for (let i = vData.length - 1; i >= 1; i--) {
    if (coincide(vData[i][vIdCol - 1], vData[i][vNomCol - 1])) vSheet.deleteRow(i + 1);
  }

  const bSheet = getOrCreateSheet(SHEET_BINGOS, COLS_BINGOS);
  const bIdVCol = colIndex_(bSheet, 'IdVendedor');
  const bNomCol = colIndex_(bSheet, 'Vendedor');
  const bData = bSheet.getDataRange().getValues();
  for (let i = bData.length - 1; i >= 1; i--) {
    if (coincide(bData[i][bIdVCol - 1], bData[i][bNomCol - 1])) bSheet.deleteRow(i + 1);
  }

  const cSheet = getOrCreateSheet(SHEET_COBROS, COLS_COBROS);
  const cIdVCol = colIndex_(cSheet, 'IdVendedor');
  const cNomCol = colIndex_(cSheet, 'Vendedor');
  const cData = cSheet.getDataRange().getValues();
  for (let i = cData.length - 1; i >= 1; i--) {
    if (coincide(cData[i][cIdVCol - 1], cData[i][cNomCol - 1])) cSheet.deleteRow(i + 1);
  }

  return jsonResponse({ status: 'ok', message: 'Vendedor eliminado' });
}

// --- Bingos ---
function addBingo(data) {
  ensureSchema_();
  const sheet = getOrCreateSheet(SHEET_BINGOS, COLS_BINGOS);
  const existentes = sheetToObjects(sheet);

  let id = String(data.idBingo || '').trim();
  const tomados = existentes.map(function (b) { return String(b['IdBingo'] || ''); });
  if (!id || tomados.indexOf(id) !== -1) id = proximoId_(tomados, 'B', 4);

  const cols = {};
  COLS_BINGOS.forEach(function (c) { cols[c] = colIndex_(sheet, c); });
  const fila = sheet.getLastRow() + 1;
  sheet.getRange(fila, cols['Vendedor']).setValue(data.vendedor);
  sheet.getRange(fila, cols['NroBingo']).setValue(data.nroBingo);
  sheet.getRange(fila, cols['Comprador']).setValue(data.comprador);
  sheet.getRange(fila, cols['IdBingo']).setValue(id);
  sheet.getRange(fila, cols['IdVendedor']).setValue(data.idVendedor || '');

  return jsonResponse({ status: 'ok', message: 'Bingo agregado', idBingo: id });
}

// Cambia numero y/o comprador. Se ubica por IdBingo (con fallback al criterio
// viejo) y propaga las copias legibles a la hoja Cobros por IdBingo.
// data: { idBingo, vendedor, nroBingoOriginal, nroBingo, comprador }
function updateBingo(data) {
  ensureSchema_();
  const idBingo = String(data.idBingo || '').trim();
  const nroViejo = Number(data.nroBingoOriginal);
  const nroNuevo = Number(data.nroBingo);
  const comprador = data.comprador;

  const bSheet = getOrCreateSheet(SHEET_BINGOS, COLS_BINGOS);
  const bCols = {};
  COLS_BINGOS.forEach(function (c) { bCols[c] = colIndex_(bSheet, c); });
  const bingos = sheetToObjects(bSheet);

  // El numero de bingo es unico a nivel club
  if (nroNuevo !== nroViejo) {
    const chocan = bingos.some(function (b) {
      const mismo = idBingo ? String(b['IdBingo'] || '') === idBingo
        : (b['Vendedor'] === data.vendedor && Number(b['NroBingo']) === nroViejo);
      return !mismo && Number(b['NroBingo']) === nroNuevo;
    });
    if (chocan) return jsonResponse({ status: 'error', message: 'El numero ' + nroNuevo + ' ya esta asignado' });
  }

  let idReal = idBingo;
  let encontrado = false;
  bingos.forEach(function (b) {
    const mismo = idBingo ? String(b['IdBingo'] || '') === idBingo
      : (b['Vendedor'] === data.vendedor && Number(b['NroBingo']) === nroViejo);
    if (!mismo) return;
    bSheet.getRange(b._row, bCols['NroBingo']).setValue(nroNuevo);
    bSheet.getRange(b._row, bCols['Comprador']).setValue(comprador);
    idReal = String(b['IdBingo'] || '');
    encontrado = true;
  });
  if (!encontrado) return jsonResponse({ status: 'error', message: 'No se encontro el bingo' });

  // Propagar las copias legibles a los cobros de ese bingo
  const cSheet = getOrCreateSheet(SHEET_COBROS, COLS_COBROS);
  const cCols = {};
  COLS_COBROS.forEach(function (c) { cCols[c] = colIndex_(cSheet, c); });
  const cobros = sheetToObjects(cSheet);
  let n = 0;
  cobros.forEach(function (c) {
    const mismo = idReal ? String(c['IdBingo'] || '') === idReal
      : (c['Vendedor'] === data.vendedor && Number(c['NroBingo']) === nroViejo);
    if (!mismo) return;
    cSheet.getRange(c._row, cCols['NroBingo']).setValue(nroNuevo);
    cSheet.getRange(c._row, cCols['Comprador']).setValue(comprador);
    n++;
  });

  return jsonResponse({ status: 'ok', message: 'Bingo actualizado', cobrosActualizados: n });
}

function deleteBingo(data) {
  ensureSchema_();
  const idBingo = String(data.idBingo || '').trim();

  const bSheet = getOrCreateSheet(SHEET_BINGOS, COLS_BINGOS);
  const bIdCol = colIndex_(bSheet, 'IdBingo');
  const bData = bSheet.getDataRange().getValues();
  for (let i = bData.length - 1; i >= 1; i--) {
    const mismo = idBingo ? String(bData[i][bIdCol - 1] || '') === idBingo
      : (bData[i][0] === data.vendedor && Number(bData[i][1]) === Number(data.nroBingo));
    if (mismo) bSheet.deleteRow(i + 1);
  }

  const cSheet = getOrCreateSheet(SHEET_COBROS, COLS_COBROS);
  const cIdCol = colIndex_(cSheet, 'IdBingo');
  const cData = cSheet.getDataRange().getValues();
  for (let i = cData.length - 1; i >= 1; i--) {
    const mismo = idBingo ? String(cData[i][cIdCol - 1] || '') === idBingo
      : (cData[i][0] === data.vendedor && Number(cData[i][1]) === Number(data.nroBingo));
    if (mismo) cSheet.deleteRow(i + 1);
  }

  return jsonResponse({ status: 'ok', message: 'Bingo eliminado' });
}

// --- Cobros ---
function registrarCobro(data) {
  ensureSchema_();
  const sheet = getOrCreateSheet(SHEET_COBROS, COLS_COBROS);
  const cols = {};
  COLS_COBROS.forEach(function (c) { cols[c] = colIndex_(sheet, c); });

  // La webapp manda data.fecha como timestamp ISO (fecha + hora).
  // Se guarda como Date real para que la planilla ordene y filtre bien.
  let fecha = new Date();
  if (data.fecha) {
    const parsed = new Date(data.fecha);
    if (!isNaN(parsed.getTime())) fecha = parsed;
  }

  const cuotas = data.cuotas || [];
  cuotas.forEach(function (nroCuota) {
    const fila = sheet.getLastRow() + 1;
    sheet.getRange(fila, cols['Vendedor']).setValue(data.vendedor);
    sheet.getRange(fila, cols['NroBingo']).setValue(data.nroBingo);
    sheet.getRange(fila, cols['Comprador']).setValue(data.comprador);
    sheet.getRange(fila, cols['NroCuota']).setValue(nroCuota);
    sheet.getRange(fila, cols['Monto']).setValue(data.montoPorCuota || 10000);
    sheet.getRange(fila, cols['MetodoPago']).setValue(data.metodo || 'Efectivo');
    sheet.getRange(fila, cols['Fecha']).setValue(fecha);
    sheet.getRange(fila, cols['Fecha']).setNumberFormat('dd/mm/yyyy hh:mm');
    sheet.getRange(fila, cols['IdBingo']).setValue(data.idBingo || '');
    sheet.getRange(fila, cols['IdVendedor']).setValue(data.idVendedor || '');
  });

  return jsonResponse({ status: 'ok', message: 'Cobro registrado' });
}

// ============ INTEGRIDAD REFERENCIAL ============
// Se corre a mano desde el editor de Apps Script para auditar la planilla.
function checkFks() {
  ensureSchema_();
  const vendedores = sheetToObjects(getOrCreateSheet(SHEET_VENDEDORES, COLS_VENDEDORES));
  const bingos = sheetToObjects(getOrCreateSheet(SHEET_BINGOS, COLS_BINGOS));
  const cobros = sheetToObjects(getOrCreateSheet(SHEET_COBROS, COLS_COBROS));

  const idsV = {}, idsB = {};
  const problemas = [];

  vendedores.forEach(function (v) {
    const id = String(v['IdVendedor'] || '');
    if (!id) problemas.push('Vendedor sin ID en fila ' + v._row);
    else if (idsV[id]) problemas.push('IdVendedor duplicado: ' + id);
    else idsV[id] = v['Nombre'];
  });

  const nrosVistos = {};
  bingos.forEach(function (b) {
    const id = String(b['IdBingo'] || '');
    if (!id) problemas.push('Bingo sin ID en fila ' + b._row);
    else if (idsB[id]) problemas.push('IdBingo duplicado: ' + id);
    else idsB[id] = true;

    const idv = String(b['IdVendedor'] || '');
    if (!idv) problemas.push('Bingo ' + id + ' sin IdVendedor');
    else if (!idsV[idv]) problemas.push('Bingo ' + id + ' apunta a un vendedor inexistente: ' + idv);
    else if (b['Vendedor'] !== idsV[idv]) problemas.push('Bingo ' + id + ' tiene el nombre de vendedor desactualizado');

    const nro = Number(b['NroBingo']);
    if (nrosVistos[nro]) problemas.push('NroBingo repetido: ' + nro);
    nrosVistos[nro] = true;
  });

  cobros.forEach(function (c) {
    const idb = String(c['IdBingo'] || '');
    if (!idb) problemas.push('Cobro huerfano (sin IdBingo) en fila ' + c._row);
    else if (!idsB[idb]) problemas.push('Cobro en fila ' + c._row + ' apunta a un bingo inexistente: ' + idb);
  });

  const resumen = {
    status: 'ok',
    vendedores: vendedores.length,
    bingos: bingos.length,
    cobros: cobros.length,
    problemas: problemas
  };
  Logger.log(JSON.stringify(resumen, null, 2));
  return jsonResponse(resumen);
}

// ============ JSON Response ============
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
