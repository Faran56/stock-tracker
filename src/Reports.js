import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { Download, FileText, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';

const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

const COLORS = ['#4f7dff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#84cc16'];

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

export default function Reports({ rows, products, itemDefaults }) {
  const [exportNote, setExportNote] = useState(null);

  // ── compute profit per row, then aggregate ──────────────────────────────
  const saleRows = useMemo(() => rows.filter(r => r.type === 'out'), [rows]);

  const byCustomer = useMemo(() => {
    const map = {};
    saleRows.forEach(r => {
      const key = r.customer || 'Unknown';
      const { revenue, cost, profit, qtyTotal } = rowProfit(r, products, itemDefaults);
      if (!map[key]) map[key] = { name: key, revenue: 0, cost: 0, profit: 0, orders: 0, qty: 0 };
      map[key].revenue += revenue;
      map[key].cost += cost;
      map[key].profit += profit;
      map[key].orders += 1;
      map[key].qty += qtyTotal;
    });
    return Object.values(map).sort((a, b) => b.profit - a.profit);
  }, [saleRows, products, itemDefaults]);

  const byProduct = useMemo(() => {
    const map = {};
    products.forEach(p => (map[p] = { name: p, revenue: 0, cost: 0, profit: 0, qty: 0 }));
    saleRows.forEach(r => {
      products.forEach(p => {
        const qty = Number(r.qty?.[p] || 0);
        if (!qty) return;
        let price = Number(r.price?.[p] || 0);
        let unitCost = Number(r.cost?.[p] || 0);
        if (!price) price = Number(itemDefaults?.[p]?.price) || 0;
        if (!unitCost) unitCost = Number(itemDefaults?.[p]?.cost) || 0;
        map[p].revenue += qty * price;
        map[p].cost += qty * unitCost;
        map[p].profit += qty * (price - unitCost);
        map[p].qty += qty;
      });
    });
    return Object.values(map).sort((a, b) => b.profit - a.profit);
  }, [saleRows, products, itemDefaults]);

  const totals = useMemo(() => {
    return saleRows.reduce((acc, r) => {
      const { revenue, cost, profit } = rowProfit(r, products, itemDefaults);
      acc.revenue += revenue;
      acc.cost += cost;
      acc.profit += profit;
      return acc;
    }, { revenue: 0, cost: 0, profit: 0 });
  }, [saleRows, products, itemDefaults]);

  const margin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;

  // ── exports ───────────────────────────────────────────────────────────────
  function exportExcel() {
    const wb = XLSX.utils.book_new();
    const custSheet = XLSX.utils.json_to_sheet(byCustomer.map(c => ({
      Customer: c.name, Orders: c.orders, 'Qty Sold': c.qty,
      Revenue: c.revenue, Cost: c.cost, Profit: c.profit,
    })));
    const prodSheet = XLSX.utils.json_to_sheet(byProduct.map(p => ({
      Product: p.name, 'Qty Sold': p.qty, Revenue: p.revenue, Cost: p.cost, Profit: p.profit,
    })));
    XLSX.utils.book_append_sheet(wb, custSheet, 'By Customer');
    XLSX.utils.book_append_sheet(wb, prodSheet, 'By Product');
    XLSX.writeFile(wb, `profit_report_${today()}.xlsx`);
    setExportNote('Exported to Excel');
    setTimeout(() => setExportNote(null), 3000);
  }

  function exportPDF() {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Profit Report', 14, 16);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Generated: ${today()}`, 14, 22);

    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text(`Total Revenue: ${fmt(totals.revenue)}  |  Total Cost: ${fmt(totals.cost)}  |  Total Profit: ${fmt(totals.profit)}  (${margin.toFixed(1)}% margin)`, 14, 30);

    autoTable(doc, {
      head: [['Customer', 'Orders', 'Qty Sold', 'Revenue', 'Cost', 'Profit']],
      body: byCustomer.map(c => [c.name, c.orders, fmt(c.qty), fmt(c.revenue), fmt(c.cost), fmt(c.profit)]),
      startY: 38,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [79, 125, 255] },
    });

    const y2 = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(12);
    doc.text('Profit by Product', 14, y2);
    autoTable(doc, {
      head: [['Product', 'Qty Sold', 'Revenue', 'Cost', 'Profit']],
      body: byProduct.map(p => [p.name, fmt(p.qty), fmt(p.revenue), fmt(p.cost), fmt(p.profit)]),
      startY: y2 + 6,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [34, 197, 94] },
    });

    doc.save(`profit_report_${today()}.pdf`);
    setExportNote('Exported to PDF');
    setTimeout(() => setExportNote(null), 3000);
  }

  return (
    <div className="reports-wrap">
      {/* ── header ── */}
      <div className="reports-header">
        <h2>Profit Reporting</h2>
        <div className="reports-actions">
          <button className="btn btn-ghost" onClick={exportExcel}><Download size={15} /> Excel</button>
          <button className="btn btn-ghost" onClick={exportPDF}><FileText size={15} /> PDF</button>
        </div>
      </div>

      {/* ── KPI cards ── */}
      <div className="kpi-strip">
        <div className="kpi-card">
          <div className="kpi-icon kpi-icon--accent"><DollarSign size={18} /></div>
          <div>
            <div className="kpi-label">Total Revenue</div>
            <div className="kpi-value">{fmt(totals.revenue)}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon kpi-icon--red"><TrendingDown size={18} /></div>
          <div>
            <div className="kpi-label">Total Cost</div>
            <div className="kpi-value">{fmt(totals.cost)}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon kpi-icon--green"><TrendingUp size={18} /></div>
          <div>
            <div className="kpi-label">Total Profit</div>
            <div className="kpi-value kpi-value--green">{fmt(totals.profit)}</div>
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

      {/* ── side by side charts ── */}
      <div className="charts-grid">
        <div className="chart-card">
          <h3>Profit by Customer</h3>
          {byCustomer.length === 0 ? (
            <div className="chart-empty">No sales data yet. Add price/cost on transactions to see profit.</div>
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

        <div className="chart-card">
          <h3>Profit by Product</h3>
          {byProduct.every(p => p.qty === 0) ? (
            <div className="chart-empty">No sales data yet. Add price/cost on transactions to see profit.</div>
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

      {/* ── tables side by side ── */}
      <div className="tables-grid">
        <div className="report-table-card">
          <h3>Customer Breakdown</h3>
          <table className="report-table">
            <thead>
              <tr><th>Customer</th><th className="num-col">Orders</th><th className="num-col">Revenue</th><th className="num-col">Cost</th><th className="num-col">Profit</th></tr>
            </thead>
            <tbody>
              {byCustomer.length === 0 && <tr><td colSpan={5} className="empty-state">No data yet</td></tr>}
              {byCustomer.map(c => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td className="num-col">{c.orders}</td>
                  <td className="num-col">{fmt(c.revenue)}</td>
                  <td className="num-col">{fmt(c.cost)}</td>
                  <td className={`num-col ${c.profit < 0 ? 'neg-text' : 'profit-text'}`}>{fmt(c.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="report-table-card">
          <h3>Product Breakdown</h3>
          <table className="report-table">
            <thead>
              <tr><th>Product</th><th className="num-col">Qty Sold</th><th className="num-col">Revenue</th><th className="num-col">Cost</th><th className="num-col">Profit</th></tr>
            </thead>
            <tbody>
              {byProduct.map(p => (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td className="num-col">{fmt(p.qty)}</td>
                  <td className="num-col">{fmt(p.revenue)}</td>
                  <td className="num-col">{fmt(p.cost)}</td>
                  <td className={`num-col ${p.profit < 0 ? 'neg-text' : 'profit-text'}`}>{fmt(p.profit)}</td>
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
