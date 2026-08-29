import React, { useMemo, useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  Download, FileText, TrendingUp, TrendingDown, DollarSign,
  Sparkles, AlertTriangle, CheckCircle2, Info, Crown, ArrowUp, ArrowDown, Loader2,
} from 'lucide-react';

const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const pct = (n) => `${Number(n || 0).toFixed(1)}%`;
const today = () => new Date().toISOString().slice(0, 10);

const COLORS = ['#4f7dff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#84cc16'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function monthLabel(m) {
  if (!m) return '';
  const [y, mo] = m.split('-');
  return `${MONTH_NAMES[Number(mo) - 1]} ${y}`;
}
function prevMonthOf(m) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function rowProfit(r, products, itemDefaults) {
  let revenue = 0, cost = 0, qtyTotal = 0;
  products.forEach(p => {
    const qty = Number(r.qty?.[p] || 0);
    let price = Number(r.price?.[p] || 0);
    let unitCost = Number(r.cost?.[p] || 0);
    if (!price) price = Number(itemDefaults?.[p]?.price) || 0;
    if (!unitCost) unitCost = Number(itemDefaults?.[p]?.cost) || 0;
    revenue += qty * price;
    cost += qty * unitCost;
    qtyTotal += qty;
  });
  return { revenue, cost, profit: revenue - cost, qtyTotal };
}

function aggregate(saleRows, products, itemDefaults) {
  const byCustomer = {};
  const byProduct = {};
  products.forEach(p => (byProduct[p] = { name: p, revenue: 0, cost: 0, profit: 0, qty: 0 }));

  saleRows.forEach(r => {
    const key = r.customer || 'Unknown';
    const { revenue, cost, profit, qtyTotal } = rowProfit(r, products, itemDefaults);
    if (!byCustomer[key]) byCustomer[key] = { name: key, revenue: 0, cost: 0, profit: 0, orders: 0, qty: 0 };
    byCustomer[key].revenue += revenue;
    byCustomer[key].cost += cost;
    byCustomer[key].profit += profit;
    byCustomer[key].orders += 1;
    byCustomer[key].qty += qtyTotal;

    products.forEach(p => {
      const qty = Number(r.qty?.[p] || 0);
      if (!qty) return;
      let price = Number(r.price?.[p] || 0) || Number(itemDefaults?.[p]?.price) || 0;
      let unitCost = Number(r.cost?.[p] || 0) || Number(itemDefaults?.[p]?.cost) || 0;
      byProduct[p].revenue += qty * price;
      byProduct[p].cost += qty * unitCost;
      byProduct[p].profit += qty * (price - unitCost);
      byProduct[p].qty += qty;
    });
  });

  const custList = Object.values(byCustomer).sort((a, b) => b.profit - a.profit);
  const prodList = Object.values(byProduct).sort((a, b) => b.profit - a.profit);
  const totals = saleRows.reduce((acc, r) => {
    const { revenue, cost, profit } = rowProfit(r, products, itemDefaults);
    acc.revenue += revenue; acc.cost += cost; acc.profit += profit;
    return acc;
  }, { revenue: 0, cost: 0, profit: 0 });

  return { byCustomer: custList, byProduct: prodList, totals };
}

function generateInsights({ totals, byCustomer, byProduct, saleRows, prevTotals, hasPrev }) {
  const notes = [];
  const margin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;

  if (totals.revenue > 0) {
    if (margin >= 30) {
      notes.push({ type: 'positive', text: `Healthy overall margin at ${pct(margin)} — well above the typical 15-20% target for distribution.` });
    } else if (margin >= 15) {
      notes.push({ type: 'info', text: `Margin is moderate at ${pct(margin)}. Room to improve by reviewing costs on lower-margin lines below.` });
    } else {
      notes.push({ type: 'warning', text: `Margin is thin at ${pct(margin)}. Focus on the weak products/customers flagged below before volume grows further.` });
    }
  }

  if (hasPrev && prevTotals.profit !== 0) {
    const delta = ((totals.profit - prevTotals.profit) / Math.abs(prevTotals.profit)) * 100;
    if (delta <= -15) {
      notes.push({ type: 'warning', text: `Profit is down ${pct(Math.abs(delta))} vs last month (${fmt(prevTotals.profit)} to ${fmt(totals.profit)}). Worth checking what changed — fewer orders, lower prices, or higher costs.` });
    } else if (delta >= 15) {
      notes.push({ type: 'positive', text: `Profit is up ${pct(delta)} vs last month (${fmt(prevTotals.profit)} to ${fmt(totals.profit)}). Whatever drove this is worth repeating.` });
    }
  }

  if (byCustomer.length > 0 && totals.revenue > 0) {
    const top = byCustomer[0];
    const share = (top.revenue / totals.revenue) * 100;
    if (share >= 25) {
      notes.push({ type: 'warning', text: `${top.name} alone accounts for ${pct(share)} of revenue this period. Consider diversifying — losing this account would hit hard.` });
    }
  }

  const soldProducts = byProduct.filter(p => p.qty > 0);
  soldProducts.forEach(p => {
    const pMargin = p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0;
    if (p.revenue > 0 && pMargin < 10) {
      notes.push({ type: 'warning', text: `${p.name} is only ${pct(pMargin)} margin this period — check if pricing or supplier cost needs adjusting.` });
    }
  });

  if (soldProducts.length > 0) {
    const best = soldProducts[0];
    if (best.profit > 0) {
      notes.push({ type: 'positive', text: `${best.name} is your strongest performer this period with ${fmt(best.profit)} profit. Consider stocking up or pushing it harder with customers.` });
    }
  }

  const dead = byProduct.filter(p => p.qty === 0);
  if (dead.length > 0 && dead.length <= 6) {
    notes.push({ type: 'info', text: `No sales recorded this period for: ${dead.map(d => d.name).join(', ')}. Worth a check-in with customers or a promo push.` });
  } else if (dead.length > 6) {
    notes.push({ type: 'info', text: `${dead.length} products had no sales this period — consider reviewing slow-moving stock.` });
  }

  const lossRows = saleRows.filter(r => rowProfit(r, byProduct.map(p => p.name), {}).profit < 0);
  if (lossRows.length > 0) {
    notes.push({ type: 'warning', text: `${lossRows.length} order${lossRows.length > 1 ? 's were' : ' was'} sold at a loss this period — see Weak Jobs below.` });
  }

  const lossCustomers = byCustomer.filter(c => c.profit < 0);
  if (lossCustomers.length > 0) {
    notes.push({ type: 'warning', text: `${lossCustomers.map(c => c.name).join(', ')} generated negative profit overall — worth reviewing pricing on these accounts.` });
  }

  if (notes.length === 0) {
    notes.push({ type: 'info', text: 'Not enough sales data in this period yet to generate meaningful insights.' });
  }

  return notes;
}

const INSIGHT_META = {
  positive: { color: '#22c55e', bg: 'rgba(34,197,94,0.1)', Icon: CheckCircle2 },
  warning:  { color: '#ef4444', bg: 'rgba(239,68,68,0.1)', Icon: AlertTriangle },
  info:     { color: '#4f7dff', bg: 'rgba(79,125,255,0.1)', Icon: Info },
};

export default function Reports({ rows, products, itemDefaults }) {
  const [exportNote, setExportNote] = useState(null);
  const [exporting, setExporting] = useState(false);

  const custChartRef = useRef(null);
  const prodChartRef = useRef(null);
  const trendChartRef = useRef(null);

  const allSaleRows = useMemo(() => rows.filter(r => r.type === 'out'), [rows]);

  const availableMonths = useMemo(
    () => [...new Set(rows.map(r => (r.date || '').slice(0, 7)).filter(Boolean))].sort((a, b) => b.localeCompare(a)),
    [rows]
  );
  const [selectedMonth, setSelectedMonth] = useState(() => availableMonths[0] || 'All');

  const saleRows = useMemo(() => {
    if (selectedMonth === 'All') return allSaleRows;
    return allSaleRows.filter(r => (r.date || '').slice(0, 7) === selectedMonth);
  }, [allSaleRows, selectedMonth]);

  const prevSaleRows = useMemo(() => {
    if (selectedMonth === 'All') return [];
    const prevKey = prevMonthOf(selectedMonth);
    return allSaleRows.filter(r => (r.date || '').slice(0, 7) === prevKey);
  }, [allSaleRows, selectedMonth]);

  const { byCustomer, byProduct, totals } = useMemo(
    () => aggregate(saleRows, products, itemDefaults),
    [saleRows, products, itemDefaults]
  );
  const { totals: prevTotals } = useMemo(
    () => aggregate(prevSaleRows, products, itemDefaults),
    [prevSaleRows, products, itemDefaults]
  );
  const hasPrev = selectedMonth !== 'All' && prevSaleRows.length > 0;
  const margin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;
  const profitDelta = hasPrev && prevTotals.profit !== 0
    ? ((totals.profit - prevTotals.profit) / Math.abs(prevTotals.profit)) * 100
    : null;

  const jobs = useMemo(() => saleRows.map(r => {
    const { revenue, cost, profit, qtyTotal } = rowProfit(r, products, itemDefaults);
    return { id: r.id, date: r.date, customer: r.customer || 'Unknown', description: r.description, invoiceNo: r.invoiceNo, qty: qtyTotal, revenue, cost, profit };
  }), [saleRows, products, itemDefaults]);
  const topJobs = [...jobs].sort((a, b) => b.profit - a.profit).slice(0, 6);
  const avgJobProfit = jobs.length > 0 ? jobs.reduce((s, j) => s + j.profit, 0) / jobs.length : 0;
  const weakJobs = [...jobs].sort((a, b) => a.profit - b.profit).slice(0, 6).filter(j => j.profit <= avgJobProfit);

  const monthlyTrend = useMemo(() => {
    const map = {};
    allSaleRows.forEach(r => {
      const m = (r.date || '').slice(0, 7);
      if (!m) return;
      const { revenue, cost, profit } = rowProfit(r, products, itemDefaults);
      if (!map[m]) map[m] = { month: m, revenue: 0, cost: 0, profit: 0 };
      map[m].revenue += revenue; map[m].cost += cost; map[m].profit += profit;
    });
    return Object.values(map)
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12)
      .map(d => ({ ...d, label: monthLabel(d.month) }));
  }, [allSaleRows, products, itemDefaults]);

  const insights = useMemo(
    () => generateInsights({ totals, byCustomer, byProduct, saleRows, prevTotals, hasPrev }),
    [totals, byCustomer, byProduct, saleRows, prevTotals, hasPrev]
  );

  const topProducts = byProduct.filter(p => p.qty > 0).slice(0, 3);

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    const custSheet = XLSX.utils.json_to_sheet(byCustomer.map(c => ({
      Customer: c.name, Orders: c.orders, 'Qty Sold': c.qty,
      Revenue: c.revenue, Cost: c.cost, Profit: c.profit,
      'Margin %': c.revenue > 0 ? ((c.profit / c.revenue) * 100).toFixed(1) : 0,
    })));
    const prodSheet = XLSX.utils.json_to_sheet(byProduct.map(p => ({
      Product: p.name, 'Qty Sold': p.qty, Revenue: p.revenue, Cost: p.cost, Profit: p.profit,
      'Margin %': p.revenue > 0 ? ((p.profit / p.revenue) * 100).toFixed(1) : 0,
    })));
    const jobSheet = XLSX.utils.json_to_sheet(jobs.map(j => ({
      Date: j.date, Customer: j.customer, Description: j.description, 'Invoice #': j.invoiceNo || '',
      Qty: j.qty, Revenue: j.revenue, Cost: j.cost, Profit: j.profit,
    })));
    const insightSheet = XLSX.utils.json_to_sheet(insights.map(i => ({ Type: i.type, Note: i.text })));
    XLSX.utils.book_append_sheet(wb, custSheet, 'By Customer');
    XLSX.utils.book_append_sheet(wb, prodSheet, 'By Product');
    XLSX.utils.book_append_sheet(wb, jobSheet, 'By Job');
    XLSX.utils.book_append_sheet(wb, insightSheet, 'AI Notes');
    XLSX.writeFile(wb, `profit_report_${selectedMonth === 'All' ? 'all' : selectedMonth}_${today()}.xlsx`);
    showNote('Exported to Excel');
  }

  async function captureChart(ref) {
    if (!ref.current) return null;
    const canvas = await html2canvas(ref.current, { backgroundColor: '#1a1d27', scale: 2 });
    return canvas;
  }

  async function exportPDF() {
    setExporting(true);
    try {
      const doc = new jsPDF();
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 14;

      doc.setFillColor(15, 17, 23);
      doc.rect(0, 0, pageW, 32, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.text('Profit Report', margin, 15);
      doc.setFontSize(10);
      doc.setTextColor(160, 170, 200);
      doc.text(`${selectedMonth === 'All' ? 'All time' : monthLabel(selectedMonth)}  -  Generated ${today()}`, margin, 23);

      const kpis = [
        { label: 'Revenue', value: fmt(totals.revenue), color: [79, 125, 255] },
        { label: 'Cost', value: fmt(totals.cost), color: [239, 68, 68] },
        { label: 'Profit', value: fmt(totals.profit), color: [34, 197, 94] },
        { label: 'Margin', value: pct(margin), color: [245, 158, 11] },
      ];
      const boxW = (pageW - margin * 2 - 3 * 6) / 4;
      let bx = margin;
      const boxY = 40;
      kpis.forEach(k => {
        doc.setFillColor(245, 246, 250);
        doc.roundedRect(bx, boxY, boxW, 22, 2, 2, 'F');
        doc.setFillColor(k.color[0], k.color[1], k.color[2]);
        doc.roundedRect(bx, boxY, 3, 22, 1, 1, 'F');
        doc.setTextColor(100, 100, 100);
        doc.setFontSize(8);
        doc.text(k.label.toUpperCase(), bx + 7, boxY + 8);
        doc.setTextColor(30, 30, 30);
        doc.setFontSize(12);
        doc.text(String(k.value), bx + 7, boxY + 17);
        bx += boxW + 6;
      });

      let y = boxY + 30;

      if (profitDelta !== null) {
        doc.setFontSize(9);
        const up = profitDelta >= 0;
        doc.setTextColor(up ? 34 : 200, up ? 150 : 60, up ? 90 : 60);
        doc.text(`${up ? 'UP' : 'DOWN'} ${pct(Math.abs(profitDelta))} vs previous month (${fmt(prevTotals.profit)})`, margin, y);
        y += 8;
      }

      doc.setTextColor(30, 30, 30);
      doc.setFontSize(12);
      doc.text('AI Notes - Focus Areas', margin, y);
      y += 6;
      doc.setFontSize(9);
      insights.forEach(note => {
        const c = note.type === 'warning' ? [220, 60, 60] : note.type === 'positive' ? [30, 140, 80] : [79, 125, 255];
        doc.setTextColor(c[0], c[1], c[2]);
        doc.text('-', margin, y);
        doc.setTextColor(60, 60, 60);
        const lines = doc.splitTextToSize(note.text, pageW - margin * 2 - 6);
        doc.text(lines, margin + 5, y);
        y += lines.length * 4.5 + 1.5;
      });
      y += 4;

      const [custCanvas, prodCanvas, trendCanvas] = await Promise.all([
        captureChart(custChartRef), captureChart(prodChartRef), captureChart(trendChartRef),
      ]);

      const addCanvasImg = (canvas, x, yPos, w) => {
        if (!canvas) return 0;
        const h = (canvas.height / canvas.width) * w;
        if (yPos + h > 280) { doc.addPage(); yPos = 16; }
        doc.addImage(canvas.toDataURL('image/png'), 'PNG', x, yPos, w, h);
        return h;
      };

      if (y > 220) { doc.addPage(); y = 16; }
      const halfW = (pageW - margin * 2 - 6) / 2;
      const h1 = addCanvasImg(custCanvas, margin, y, halfW);
      addCanvasImg(prodCanvas, margin + halfW + 6, y, halfW);
      y += h1 + 10;

      if (trendCanvas) {
        if (y > 220) { doc.addPage(); y = 16; }
        const h2 = addCanvasImg(trendCanvas, margin, y, pageW - margin * 2);
        y += h2 + 10;
      }

      doc.addPage();
      doc.setTextColor(30, 30, 30);
      doc.setFontSize(13);
      doc.text('Profit by Customer (Job)', margin, 18);
      autoTable(doc, {
        head: [['Customer', 'Orders', 'Qty', 'Revenue', 'Cost', 'Profit', 'Margin']],
        body: byCustomer.map(c => [
          c.name, c.orders, fmt(c.qty), fmt(c.revenue), fmt(c.cost), fmt(c.profit),
          c.revenue > 0 ? pct((c.profit / c.revenue) * 100) : '-',
        ]),
        startY: 24,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [79, 125, 255] },
      });

      let y2 = doc.lastAutoTable.finalY + 12;
      doc.setFontSize(13);
      doc.text('Profit by Product', margin, y2);
      autoTable(doc, {
        head: [['Product', 'Qty Sold', 'Revenue', 'Cost', 'Profit', 'Margin']],
        body: byProduct.map((p, i) => [
          i < 3 && p.profit > 0 ? `${p.name}  * High Profit` : p.name,
          fmt(p.qty), fmt(p.revenue), fmt(p.cost), fmt(p.profit),
          p.revenue > 0 ? pct((p.profit / p.revenue) * 100) : '-',
        ]),
        startY: y2 + 6,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [34, 197, 94] },
      });

      let y3 = doc.lastAutoTable.finalY + 12;
      if (y3 > 250) { doc.addPage(); y3 = 16; }
      doc.setFontSize(13);
      doc.text('Top Jobs', margin, y3);
      autoTable(doc, {
        head: [['Date', 'Customer', 'Description', 'Qty', 'Profit']],
        body: topJobs.map(j => [j.date, j.customer, j.description || '-', fmt(j.qty), fmt(j.profit)]),
        startY: y3 + 6,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [34, 197, 94] },
      });

      let y4 = doc.lastAutoTable.finalY + 12;
      if (weakJobs.length > 0) {
        if (y4 > 250) { doc.addPage(); y4 = 16; }
        doc.setFontSize(13);
        doc.text('Weak Jobs - Review These', margin, y4);
        autoTable(doc, {
          head: [['Date', 'Customer', 'Description', 'Qty', 'Profit']],
          body: weakJobs.map(j => [j.date, j.customer, j.description || '-', fmt(j.qty), fmt(j.profit)]),
          startY: y4 + 6,
          styles: { fontSize: 8, cellPadding: 3 },
          headStyles: { fillColor: [239, 68, 68] },
          bodyStyles: { textColor: [150, 30, 30] },
        });
      }

      doc.save(`profit_report_${selectedMonth === 'All' ? 'all' : selectedMonth}_${today()}.pdf`);
      showNote('Exported to PDF');
    } finally {
      setExporting(false);
    }
  }

  function showNote(msg) {
    setExportNote(msg);
    setTimeout(() => setExportNote(null), 3000);
  }

  return (
    <div className="reports-wrap">
      <div className="reports-header">
        <div>
          <h2>Profit Reporting</h2>
          <div className="reports-sub">{selectedMonth === 'All' ? 'All-time overview' : `Report for ${monthLabel(selectedMonth)}`}</div>
        </div>
        <div className="reports-actions">
          <select className="month-select" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
            <option value="All">All time</option>
            {availableMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <button className="btn btn-ghost" onClick={exportExcel}><Download size={15} /> Excel</button>
          <button className="btn btn-ghost" onClick={exportPDF} disabled={exporting}>
            {exporting ? <Loader2 size={15} className="spin" /> : <FileText size={15} />} PDF
          </button>
        </div>
      </div>

      <div className="kpi-strip">
        <div className="kpi-card">
          <div className="kpi-icon kpi-icon--accent"><DollarSign size={18} /></div>
          <div>
            <div className="kpi-label">Revenue</div>
            <div className="kpi-value">{fmt(totals.revenue)}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon kpi-icon--red"><TrendingDown size={18} /></div>
          <div>
            <div className="kpi-label">Cost</div>
            <div className="kpi-value">{fmt(totals.cost)}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon kpi-icon--green"><TrendingUp size={18} /></div>
          <div>
            <div className="kpi-label">Profit</div>
            <div className="kpi-value kpi-value--green">{fmt(totals.profit)}</div>
            {profitDelta !== null && (
              <div className={`kpi-delta ${profitDelta >= 0 ? 'up' : 'down'}`}>
                {profitDelta >= 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />} {pct(Math.abs(profitDelta))} vs last month
              </div>
            )}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon kpi-icon--accent"><TrendingUp size={18} /></div>
          <div>
            <div className="kpi-label">Margin</div>
            <div className="kpi-value">{margin.toFixed(1)}%</div>
          </div>
        </div>
      </div>

      <div className="insights-card">
        <div className="insights-header">
          <Sparkles size={16} />
          <span>AI Notes — Focus Areas</span>
        </div>
        <div className="insights-list">
          {insights.map((note, i) => {
            const meta = INSIGHT_META[note.type];
            const Icon = meta.Icon;
            return (
              <div key={i} className="insight-item" style={{ background: meta.bg }}>
                <Icon size={15} color={meta.color} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{note.text}</span>
              </div>
            );
          })}
        </div>
      </div>

      {topProducts.length > 0 && (
        <div className="highlight-strip">
          {topProducts.map((p, i) => (
            <div key={p.name} className="highlight-card">
              <div className="highlight-rank"><Crown size={14} /> #{i + 1} High Profit Product</div>
              <div className="highlight-name">{p.name}</div>
              <div className="highlight-profit">{fmt(p.profit)}</div>
              <div className="highlight-sub">{p.revenue > 0 ? pct((p.profit / p.revenue) * 100) : '—'} margin · {fmt(p.qty)} units sold</div>
            </div>
          ))}
        </div>
      )}

      <div className="charts-grid">
        <div className="chart-card" ref={custChartRef}>
          <h3>Profit by Customer</h3>
          {byCustomer.length === 0 ? (
            <div className="chart-empty">No sales data for this period yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={byCustomer.slice(0, 8)} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2e3250" horizontal={false} />
                <XAxis type="number" stroke="#6b7280" fontSize={11} />
                <YAxis type="category" dataKey="name" stroke="#9ca3af" fontSize={11} width={110} />
                <Tooltip
                  contentStyle={{ background: '#1a1d27', border: '1px solid #2e3250', borderRadius: 8, fontSize: 12 }}
                  formatter={(v) => fmt(v)}
                />
                <Bar dataKey="profit" radius={[0, 4, 4, 0]}>
                  {byCustomer.slice(0, 8).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="chart-card" ref={prodChartRef}>
          <h3>Profit by Product</h3>
          {byProduct.every(p => p.qty === 0) ? (
            <div className="chart-empty">No sales data for this period yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={byProduct.filter(p => p.profit !== 0)}
                  dataKey="profit"
                  nameKey="name"
                  cx="50%" cy="50%"
                  outerRadius={95}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                  fontSize={11}
                >
                  {byProduct.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#1a1d27', border: '1px solid #2e3250', borderRadius: 8, fontSize: 12 }}
                  formatter={(v) => fmt(v)}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="chart-card chart-card--wide" ref={trendChartRef}>
        <h3>Monthly Profit Trend</h3>
        {monthlyTrend.length < 2 ? (
          <div className="chart-empty">Need at least two months of sales data to show a trend.</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={monthlyTrend} margin={{ left: 4, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2e3250" />
              <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} />
              <YAxis stroke="#6b7280" fontSize={11} />
              <Tooltip
                contentStyle={{ background: '#1a1d27', border: '1px solid #2e3250', borderRadius: 8, fontSize: 12 }}
                formatter={(v) => fmt(v)}
              />
              <Line type="monotone" dataKey="profit" stroke="#22c55e" strokeWidth={2.5} dot={{ r: 3 }} name="Profit" />
              <Line type="monotone" dataKey="revenue" stroke="#4f7dff" strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="4 3" name="Revenue" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="tables-grid">
        <div className="report-table-card">
          <h3>Top Jobs</h3>
          <table className="report-table">
            <thead>
              <tr><th>Customer</th><th>Date</th><th className="num-col">Qty</th><th className="num-col">Profit</th></tr>
            </thead>
            <tbody>
              {topJobs.length === 0 && <tr><td colSpan={4} className="empty-state">No data yet</td></tr>}
              {topJobs.map(j => (
                <tr key={j.id}>
                  <td>{j.customer}<div className="memo-cell">{j.description}</div></td>
                  <td className="mono-cell">{j.date}</td>
                  <td className="num-col">{fmt(j.qty)}</td>
                  <td className="num-col profit-text">{fmt(j.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="report-table-card">
          <h3>Weak Jobs — Review These</h3>
          <table className="report-table">
            <thead>
              <tr><th>Customer</th><th>Date</th><th className="num-col">Qty</th><th className="num-col">Profit</th></tr>
            </thead>
            <tbody>
              {weakJobs.length === 0 && <tr><td colSpan={4} className="empty-state">Nothing flagged — good period</td></tr>}
              {weakJobs.map(j => (
                <tr key={j.id} className={j.profit < 0 ? 'row-loss' : ''}>
                  <td>{j.customer}<div className="memo-cell">{j.description}</div></td>
                  <td className="mono-cell">{j.date}</td>
                  <td className="num-col">{fmt(j.qty)}</td>
                  <td className={`num-col ${j.profit < 0 ? 'neg-text' : ''}`}>{fmt(j.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tables-grid">
        <div className="report-table-card">
          <h3>Customer Breakdown</h3>
          <table className="report-table">
            <thead>
              <tr><th>Customer</th><th className="num-col">Orders</th><th className="num-col">Revenue</th><th className="num-col">Cost</th><th className="num-col">Profit</th><th className="num-col">Margin</th></tr>
            </thead>
            <tbody>
              {byCustomer.length === 0 && <tr><td colSpan={6} className="empty-state">No data yet</td></tr>}
              {byCustomer.map(c => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td className="num-col">{c.orders}</td>
                  <td className="num-col">{fmt(c.revenue)}</td>
                  <td className="num-col">{fmt(c.cost)}</td>
                  <td className={`num-col ${c.profit < 0 ? 'neg-text' : 'profit-text'}`}>{fmt(c.profit)}</td>
                  <td className="num-col">{c.revenue > 0 ? pct((c.profit / c.revenue) * 100) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="report-table-card">
          <h3>Product Breakdown</h3>
          <table className="report-table">
            <thead>
              <tr><th>Product</th><th className="num-col">Qty Sold</th><th className="num-col">Revenue</th><th className="num-col">Cost</th><th className="num-col">Profit</th><th className="num-col">Margin</th></tr>
            </thead>
            <tbody>
              {byProduct.map((p, i) => (
                <tr key={p.name}>
                  <td>{p.name}{i < 3 && p.profit > 0 && <span className="crown-badge"><Crown size={11} /> High</span>}</td>
                  <td className="num-col">{fmt(p.qty)}</td>
                  <td className="num-col">{fmt(p.revenue)}</td>
                  <td className="num-col">{fmt(p.cost)}</td>
                  <td className={`num-col ${p.profit < 0 ? 'neg-text' : 'profit-text'}`}>{fmt(p.profit)}</td>
                  <td className="num-col">{p.revenue > 0 ? pct((p.profit / p.revenue) * 100) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {exportNote && <div className="toast">{exportNote}</div>}
    </div>
  );
}
