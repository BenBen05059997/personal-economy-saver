/** Plan became Spending and Saving. Canvases stored with a /plan link still land on Spending, with their month and search. */
export function GET(request: Request) {
  const from = new URL(request.url).searchParams;
  const params = new URLSearchParams();
  for (const name of ["month", "q"]) for (const value of from.getAll(name)) params.append(name, value);
  const search = params.toString();
  return new Response(null, { status: 307, headers: { Location: search ? `/spending?${search}` : "/spending", "Cache-Control": "no-store" } });
}
