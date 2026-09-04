import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Loading } from './components/Loading';
import { AppLayout } from './layouts/AppLayout';

const DashboardPage = lazy(async () => ({ default: (await import('./pages/DashboardPage')).DashboardPage }));
const HotStocksPage = lazy(async () => ({ default: (await import('./pages/HotStocksPage')).HotStocksPage }));
const RecommendationsPage = lazy(async () => ({ default: (await import('./pages/RecommendationsPage')).RecommendationsPage }));
const StockDetailsPage = lazy(async () => ({ default: (await import('./pages/StockDetailsPage')).StockDetailsPage }));
const StocksPage = lazy(async () => ({ default: (await import('./pages/StocksPage')).StocksPage }));
const CalendarPage = lazy(async () => ({ default: (await import('./pages/CalendarPage')).CalendarPage }));
const StrategyScreensPage = lazy(async () => ({ default: (await import('./pages/StrategyScreensPage')).StrategyScreensPage }));
const QuantSignalsPage = lazy(async () => ({ default: (await import('./pages/QuantSignalsPage')).QuantSignalsPage }));
const NewsPage = lazy(async () => ({ default: (await import('./pages/NewsPage')).NewsPage }));

export default function App() {
  return (
    <Suspense fallback={<Loading/>}>
      <Routes>
        <Route element={<AppLayout/>}>
          <Route path="/dashboard" element={<DashboardPage/>}/>
          <Route path="/news" element={<NewsPage/>}/>
          <Route path="/hot-stocks" element={<HotStocksPage/>}/>
          <Route path="/stocks" element={<StocksPage/>}/>
          <Route path="/stocks/:symbol" element={<StockDetailsPage/>}/>
          <Route path="/recommendations" element={<RecommendationsPage/>}/>
          <Route path="/calendar" element={<CalendarPage/>}/>
          <Route path="/strategy-screens" element={<StrategyScreensPage/>}/>
          <Route path="/ai-signals" element={<QuantSignalsPage/>}/>
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace/>}/>
      </Routes>
    </Suspense>
  );
}
