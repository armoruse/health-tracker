// BODY Apps Script - Auto-deployed via GitHub Actions
const SPREADSHEET_ID = '1p_x4wmHNx1fV-Y0C4Af2D86mBfqwxp0dOe58EiQ6cfQ';
const SETTINGS_SHEET = 'Settings';
const PHYSIQUE_SHEET = 'PhysiqueLog';
const SUMMARY_SHEET = 'DailySummary';

function doGet(e) {
  try {
    const action = (e.parameter.action || 'dashboard').toLowerCase();
    if (action === 'health') return json_({ ok: true, service: 'BODY sync', version: 'V21.1-fast' });
    if (action === 'state') return json_(getState_());
    if (action === 'dashboard') return json_(getDashboard_(e.parameter.date || ''));
    if (action === 'image') return json_(getImage_(e.parameter.slot, e.parameter.view));
    return json_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : '{}');
    const action = String(payload.action || '').toLowerCase();
    if (action === 'savegoal') {
      const weight = Number(payload.goalWeightKg);
      const min = Number(payload.goalBodyFatMin);
      const max = Number(payload.goalBodyFatMax);
      const desc = String(payload.goalDescription || '').trim();
      if (!isFinite(weight) || weight < 40 || weight > 200) throw new Error('?ÆÊ?È´îÈ??ºÂ??ØË™§');
      if (!isFinite(min) || !isFinite(max) || min < 3 || max > 60 || min > max) throw new Error('?ÆÊ?È´îË??ºÂ??ØË™§');
      setSetting_('goal_weight_kg', String(weight), '?ÆÂ??ÆÊ?È´îÈ?');
      setSetting_('goal_body_fat_pct', min === max ? String(min) : `${min}~${max}`, '?ÆÂ??ÆÊ?È´îË?ÁØÑÂ?ÔºàÁ??áÂ?ÔºåÈÅø?çË¢´ Sheets Ëß???êÊó•?üÔ?');
      setSetting_('goal_description', desc, 'Dashboard ??GPT ?±Áî®?ÆÊ??èËø∞');
      setSetting_('web_sync_updated_at', now_(), '?ÄËøë‰?Ê¨°Á∂≤?ÅÂ?Ê≠•Ê???);
      return json_({ ok: true, state: getState_() });
    }
    // V17 Ëµ∑ÁÖß?á‰??çÁî±Á∂≤Á??¥Êé•‰∏äÂÇ≥?ÇÁÖß?áÁî± BODY?åÈ??ãÁ??Ñ„ÄçÂ?Ë©±Ê??§Ë?ÂæåÂØ´??Drive / PhysiqueLog??    return json_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function getDashboard_(requestedDate) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  const yesterday = Utilities.formatDate(new Date(Date.now() - 86400000), 'Asia/Taipei', 'yyyy-MM-dd');
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(requestedDate || '')) ? String(requestedDate) : '';
  const daily = sheetObjects_(ss.getSheetByName('Daily'));
  const foods = sheetObjects_(ss.getSheetByName('FoodLog'));
  const measurements = sheetObjects_(ss.getSheetByName('MeasurementLog'));
  const workouts = sheetObjects_(ss.getSheetByName('WorkoutLog'));
  const history = sheetObjects_(ss.getSheetByName('HistoryArchive'));
  const physique = sheetObjects_(ss.getSheetByName(PHYSIQUE_SHEET));
  const summaries = sheetObjects_(ss.getSheetByName(SUMMARY_SHEET));
  const settingsMap = settingsMap_(ss);

  const circumferenceRows = physique.filter(r => String(r.PhotoView || '').toLowerCase() === 'circumference');
  const latestCircRow = circumferenceRows.slice(-1)[0] || null;
  const latestCircumference = latestCircRow ? parseCircumference_(latestCircRow) : null;
  const latestPhysiqueAnalysis = {
    front: latestAnalysisForView_(physique, 'front'),
    side: latestAnalysisForView_(physique, 'side'),
    back: latestAnalysisForView_(physique, 'back')
  };

  const selectedCircRow = selectedDate ? circumferenceRows.filter(r => normDate_(r.Date) <= selectedDate).slice(-1)[0] || null : null;
  const selectedCircumference = selectedCircRow ? parseCircumference_(selectedCircRow) : null;
  const selectedPhysiqueAnalysis = selectedDate ? {
    front: latestAnalysisForViewAt_(physique, 'front', selectedDate),
    side: latestAnalysisForViewAt_(physique, 'side', selectedDate),
    back: latestAnalysisForViewAt_(physique, 'back', selectedDate)
  } : null;

  return {
    ok: true,
    generatedAt: now_(),
    today,
    yesterday,
    selectedDate: selectedDate || null,
    selectedDaily: selectedDate ? daily.filter(r => normDate_(r.Date) === selectedDate).slice(-1)[0] || null : null,
    selectedFoods: selectedDate ? foods.filter(r => normDate_(r.Date) === selectedDate) : [],
    selectedWorkouts: selectedDate ? workouts.filter(r => normDate_(r.Date) === selectedDate) : [],
    selectedMeasurement: selectedDate ? measurements.filter(r => normDate_(r.Date) === selectedDate).slice(-1)[0] || null : null,
    selectedSummary: selectedDate ? summaries.filter(r => normDate_(r.Date) === selectedDate).slice(-1)[0] || null : null,
    selectedCircumference,
    selectedPhysiqueAnalysis,
    todayDaily: daily.filter(r => normDate_(r.Date) === today).slice(-1)[0] || null,
    todayFoods: foods.filter(r => normDate_(r.Date) === today),
    todayWorkouts: workouts.filter(r => normDate_(r.Date) === today),
    todayMeasurement: measurements.filter(r => normDate_(r.Date) === today).slice(-1)[0] || null,
    recentDaily: daily.filter(r => r.Date).slice(-45).reverse(),
    recentFoods: foods.filter(r => r.Date).slice(-60).reverse(),
    recentMeasurements: measurements.filter(r => r.Date).slice(-45).reverse(),
    recentWorkouts: workouts.filter(r => r.Date).slice(-45).reverse(),
    recentHistory: history.filter(r => r.RelatedDate || r.RecordedAt).slice(-30).reverse(),
    recentPhysique: physique.filter(r => r.Date).slice(-40).reverse(),
    latestCircumference,
    latestPhysiqueAnalysis,
    yesterdaySummary: summaries.filter(r => normDate_(r.Date) === yesterday).slice(-1)[0] || null,
    recentSummaries: summaries.filter(r => r.Date).slice(-14).reverse(),
    counts: {
      food: foods.length,
      measurement: measurements.length,
      workout: workouts.length,
      history: history.length,
      physique: physique.length,
      summary: summaries.length
    },
    settings: stateFromSettings_(settingsMap)
  };
}

function settingsMap_(ss) {
  const sh = ss.getSheetByName(SETTINGS_SHEET);
  const out = {};
  if (!sh) return out;
  const v = sh.getDataRange().getDisplayValues();
  for (let i = 1; i < v.length; i++) {
    const key = String(v[i][0] || '').trim();
    if (key) out[key] = v[i][1] == null ? '' : String(v[i][1]);
  }
  return out;
}

function stateFromSettings_(settings) {
  const s = settings || {};
  const bf = parseBf_(s.goal_body_fat_pct || '15-16');
  return {
    ok: true,
    goalWeightKg: Number(s.goal_weight_kg || 75),
    goalBodyFatMin: bf.min,
    goalBodyFatMax: bf.max,
    goalDescription: s.goal_description || '',
    nutritionCalorieTarget: Number(s.nutrition_calorie_target || 2050),
    nutritionProteinTargetG: Number(s.nutrition_protein_target_g || 160),
    nutritionCarbsTargetG: Number(s.nutrition_carbs_target_g || 195),
    nutritionFatTargetG: Number(s.nutrition_fat_target_g || 70),
    nutritionDayMode: s.nutrition_day_mode || 'single',
    updatedAt: s.web_sync_updated_at || ''
  };
}

function getState_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return stateFromSettings_(settingsMap_(ss));
}

function getImage_(slot, view) {
  if (!['current', 'target'].includes(slot) || !['front', 'side', 'back'].includes(view)) throw new Error('slot/view ?ØË™§');
  const id = getSetting_(`${slot}_${view}_file_id`);
  if (!id) return { ok: true, missing: true };
  const f = DriveApp.getFileById(id);
  const b = f.getBlob();
  return { ok: true, missing: false, fileId: id, mimeType: b.getContentType(), filename: f.getName(), base64: Utilities.base64Encode(b.getBytes()) };
}

function latestAnalysisForView_(rows, view) {
  const matches = rows.filter(r => {
    const pv = String(r.PhotoView || '');
    if (/target/i.test(pv)) return false;
    if (view === 'front') return /Ê≠?ù¢|current-front/i.test(pv);
    if (view === 'side') return /?¥Èù¢|current-side/i.test(pv);
    return /?åÈù¢|current-back/i.test(pv);
  }).filter(r => String(r.Analysis || '').trim() || String(r.ComparisonComment || '').trim());
  return matches.slice(-1)[0] || null;
}

function latestAnalysisForViewAt_(rows, view, date) {
  const matches = rows.filter(r => normDate_(r.Date) && normDate_(r.Date) <= date).filter(r => {
    const pv = String(r.PhotoView || '');
    if (/target/i.test(pv)) return false;
    if (view === 'front') return /Ê≠?ù¢|current-front/i.test(pv);
    if (view === 'side') return /?¥Èù¢|current-side/i.test(pv);
    return /?åÈù¢|current-back/i.test(pv);
  }).filter(r => String(r.Analysis || '').trim() || String(r.ComparisonComment || '').trim());
  return matches.slice(-1)[0] || null;
}

function parseCircumference_(row) {
  const text = String(row.Analysis || '');
  const take = label => {
    const m = text.match(new RegExp(label + '\\s*(\\d+(?:\\.\\d+)?)\\s*cm', 'i'));
    return m ? Number(m[1]) : null;
  };
  return {
    date: normDate_(row.Date), timestamp: row.Timestamp || '', weightKg: numberOrNull_(row.WeightKg), bodyFatPct: numberOrNull_(row.BodyFatPct),
    neckCm: take('?∏Â?'), waistCm: take('?∞Â?'), chestCm: take('?∏Â?'), armCm: take('?ãË???), hipCm: take('?Ä??), thighCm: take('Â§ßËÖø??),
    analysis: row.Analysis || '', comparisonComment: row.ComparisonComment || '', source: row.Source || ''
  };
}

function numberOrNull_(v) {
  const n = Number(String(v == null ? '' : v).replace(/,/g, ''));
  return isFinite(n) ? n : null;
}

function sheetObjects_(sheet) {
  if (!sheet) return [];
  const v = sheet.getDataRange().getDisplayValues();
  if (!v.length) return [];
  const h = v[0].map(String);
  return v.slice(1).filter(r => r.some(x => String(x).trim() !== '')).map(r => {
    const o = {};
    h.forEach((k, i) => o[k] = r[i] == null ? '' : String(r[i]));
    return o;
  });
}
function normDate_(v) {
  const s = String(v || '').trim(), m = s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  return m ? `${m[1]}-${('0' + m[2]).slice(-2)}-${('0' + m[3]).slice(-2)}` : s.slice(0, 10);
}
function getSetting_(key) {
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SETTINGS_SHEET);
  const v = sh.getDataRange().getDisplayValues();
  for (let i = 1; i < v.length; i++) if (String(v[i][0]) === key) return v[i][1] == null ? '' : String(v[i][1]);
  return '';
}
function setSetting_(key, value, note) {
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SETTINGS_SHEET), v = sh.getDataRange().getDisplayValues();
  for (let i = 1; i < v.length; i++) if (String(v[i][0]) === key) {
    const cell = sh.getRange(i + 1, 2);
    if (key === 'goal_body_fat_pct') cell.setNumberFormat('@');
    cell.setValue(String(value));
    if (note != null) sh.getRange(i + 1, 3).setValue(note);
    return;
  }
  const row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, 3).setValues([[key, String(value), note || '']]);
  if (key === 'goal_body_fat_pct') sh.getRange(row, 2).setNumberFormat('@');
}
function parseBf_(s) {
  const raw = String(s == null ? '' : s).trim();
  let n = raw.match(/\d+(?:\.\d+)?/g) || [];
  let min = Number(n[0]), max = Number(n[1] || n[0]);
  // ?≤Á¶¶?äË??ôÊõæË¢?Sheets Ëß???êÊó•?üÔ?‰æãÂ? 12-16 -> 2026/12/16??  // ‰ªª‰?‰∏çÂ??ÜÈ??ÇÁ??çÈÉΩ?¥Êé•?ûÂà∞Ê≠???ÆÊ? 15~16ÔºåÈÅø?çÂπ¥‰ªΩË¢´?∂Ê??æÂ?ÊØî„Ä?  if (!isFinite(min) || !isFinite(max) || min < 3 || max > 60 || min > max) return { min: 15, max: 16 };
  return { min, max };
}
function now_() { return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss'); }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
