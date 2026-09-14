import BrowsePage from "./BrowsePage";

export default function App() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800">
        <div className="mx-auto max-w-6xl px-6 py-5">
          <h1 className="text-lg font-semibold tracking-tight">Now Showing</h1>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <BrowsePage />
      </main>
    </div>
  );
}
