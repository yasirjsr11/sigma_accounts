const express = require('express');
const router = express.Router();
const { requireLogin, requireModule } = require('../middleware/auth.js');
const { buildReport, REPORT_TYPES } = require('../reports/builder.js');
const { toExcelBuffer, toPdfBuffer } = require('../reports/render.js');

router.use(requireLogin, requireModule('reports'));

router.get('/', (req, res) => {
  res.json({ types: REPORT_TYPES });
});

// Data endpoint — supports all filter/pagination query params
router.get('/:type/data', (req, res) => {
  const { type } = req.params;
  if (!REPORT_TYPES.includes(type)) return res.status(404).json({ error: 'Unknown report type' });
  try {
    const report = buildReport(type, req.query, false);
    res.json(report);
  } catch (err) {
    console.error('Report build error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Excel export — all rows (forExport=true overrides pagination)
router.get('/:type.xlsx', async (req, res) => {
  const { type } = req.params;
  if (!REPORT_TYPES.includes(type)) return res.status(404).json({ error: 'Unknown report type' });
  try {
    const report = buildReport(type, req.query, true);
    const buffer = await toExcelBuffer(report);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${type}-report.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PDF export — all rows (forExport=true overrides pagination)
router.get('/:type.pdf', async (req, res) => {
  const { type } = req.params;
  if (!REPORT_TYPES.includes(type)) return res.status(404).json({ error: 'Unknown report type' });
  try {
    const report = buildReport(type, req.query, true);
    const buffer = await toPdfBuffer(report);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${type}-report.pdf"`);
    res.send(buffer);
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
