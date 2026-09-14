import { Link, Route, Routes } from "react-router-dom";
import BrowsePage from "./pages/BrowsePage";
import ConfirmationPage from "./pages/ConfirmationPage";
import SeatMapPage from "./pages/SeatMapPage";
import { shortDeviceId } from "./lib/device";

export default function App() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800">
        <div className="mx-auto flex max-w-6xl items-baseline justify-between gap-4 px-6 py-5">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            Now Showing
          </Link>
          {/* Shown so two browsers are distinguishable while testing: if a hold
              seems to vanish, the device id changing is the explanation. */}
          <span className="font-mono text-[10px] text-neutral-600">
            device {shortDeviceId()}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Routes>
          <Route path="/" element={<BrowsePage />} />
          <Route path="/shows/:showId/seats" element={<SeatMapPage />} />
          <Route path="/reservations/:holdId" element={<ConfirmationPage />} />
          <Route
            path="*"
            element={
              <p className="text-sm text-neutral-400">
                Nothing here.{" "}
                <Link to="/" className="underline">
                  Back to showtimes
                </Link>
              </p>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
