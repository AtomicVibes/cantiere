import ExcelJS from 'exceljs';
import { getFeatureForAction } from './auditFeatureMapping';

const MAX_CELL_JSON_LENGTH = 32000;

const COLUMNS = [
  { header: 'Date/Time', key: 'created_at', width: 20 },
  { header: 'User', key: 'user', width: 28 },
  { header: 'User ID', key: 'user_id', width: 40 },
  { header: 'Feature', key: 'feature', width: 16 },
  { header: 'Action', key: 'action_type', width: 24 },
  { header: 'Message', key: 'message', width: 50 },
  { header: 'Entity Type', key: 'entity_type', width: 18 },
  { header: 'Entity ID', key: 'entity_id', width: 40 },
  { header: 'Project ID', key: 'project_id', width: 40 },
  { header: 'Details', key: 'details', width: 60 },
  { header: 'Old Values', key: 'old_values', width: 60 },
  { header: 'New Values', key: 'new_values', width: 60 },
  { header: 'Archived', key: 'archived', width: 10 },
];

function serialize(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    if (json.length > MAX_CELL_JSON_LENGTH) {
      return `${json.slice(0, MAX_CELL_JSON_LENGTH)}... [truncated]`;
    }
    return json;
  }
  return String(value);
}

export async function exportAuditLogsToExcel(logs, resolveUserName) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Geometra Audit Logs';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Audit Logs');

  sheet.columns = COLUMNS.map((col) => ({ ...col, width: col.width }));
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle' };

  logs.forEach((log) => {
    sheet.addRow({
      created_at: log.created_at ? new Date(log.created_at) : '',
      user: resolveUserName(log.user_id),
      user_id: log.user_id || '',
      feature: getFeatureForAction(log.action_type).name,
      action_type: log.action_type || '',
      message: log.message || '',
      entity_type: log.entity_type || '',
      entity_id: log.entity_id || '',
      project_id: log.project_id || '',
      details: serialize(log.details),
      old_values: serialize(log.old_values),
      new_values: serialize(log.new_values),
      archived: log.archived ? 'Yes' : 'No',
    });
  });

  sheet.getRow(1).height = 18;
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(sheet.rowCount, 1), column: COLUMNS.length } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}