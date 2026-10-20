/**
 * Progress dashboard — FR-13, document section 3.5.3.
 *
 * Shows overall recall accuracy, forgetting frequency by category (bar chart),
 * accuracy improvement over time (line chart), streak counters, and the AI's
 * motivational message. All figures come from real session data.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { BarChart, ChartLegend, LineChart } from '../components/Charts.jsx';
import { Loading, Toast, useToast } from '../lib/ui.jsx';

export default function Analytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { message, showToast } = useToast();

  useEffect(() => {
    api
      .getAnalytics()
      .then((res) => setData(res.analytics))
      .catch((err) => showToast(err.message))
      .finally(() => setLoading(false));
  }, [showToast]);

  if (loading) return <Loading label="Putting your progress together…" />;
  if (!data) return <Toast message={message} />;

  return (
    <>
      <Toast message={message} />

      <div className="stage-inner">
      <div className="analytics-page">
        <header style={{ marginBottom: '10px' }}>
          <h1>Your progress</h1>
          <p>How your memory is doing, in plain language.</p>
        </header>

        <div className="analytics-stats">
          <div className="dark-card">
            <div className="stat-value">{data.overall_accuracy}%</div>
            <div className="stat-label">Overall recall accuracy</div>
          </div>
          <div className="dark-card">
            <div className="stat-value">{data.total_attempts}</div>
            <div className="stat-label">Recall attempts</div>
          </div>
          <div className="dark-card">
            <div className="stat-value">{data.total_passed}</div>
            <div className="stat-label">Recalled well</div>
          </div>
          <div className="dark-card">
            <div className="stat-value">{data.recall_streak}</div>
            <div className="stat-label">Day recall streak</div>
          </div>
          <div className="dark-card">
            <div className="stat-value">{data.exercise_streak}</div>
            <div className="stat-label">Day exercise streak</div>
          </div>
        </div>

        <section className="chart-card">
          <h3>Forgetting frequency by category</h3>
          <BarChart data={data.categories} />
          <ChartLegend />
        </section>

        <section className="chart-card">
          <h3>Accuracy over the last eight weeks</h3>
          <LineChart data={data.trend} />
        </section>

        {data.weakest_category && (
          <p style={{ marginTop: '4px' }}>
            <span className="badge badge-gold">Area to focus on: {data.weakest_category}</span>
          </p>
        )}

        <div className="motivation-banner">{data.motivational_message}</div>
      </div>
      </div>
    </>
  );
}
