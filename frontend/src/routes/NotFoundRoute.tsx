import { Link } from "react-router-dom";

export function NotFoundRoute() {
  return (
    <div className="card p-8 text-center space-y-2">
      <div className="text-4xl">⚽</div>
      <h1 className="text-lg font-semibold text-ink">Off target — page not found.</h1>
      <p className="text-sm text-ink-muted">That route doesn't exist.</p>
      <Link to="/" className="btn-brand inline-flex">
        Back to Home
      </Link>
    </div>
  );
}
