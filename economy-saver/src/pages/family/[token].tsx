import type { GetServerSideProps, InferGetServerSidePropsType } from "next";
import Head from "next/head";
import { renderToStaticMarkup } from "react-dom/server";
import { FamilyView } from "@/components/family/FamilyView";
import { withOwnedDatabase } from "@/db/client-core";
import { loadFamilyView, resolveFamilyLink } from "@/db/family-links";
import { withHousehold } from "@/db/household";

// This public URL needs the HTTP status before rendering, including when a Worker serves
// a prerendered App Router shell. The Pages Router runs this lookup before writing the body.
export const getServerSideProps = (async ({ params, res }) => {
  const token = params?.token;
  const view = typeof token === "string" ? await withOwnedDatabase(async db => {
    const hid = await resolveFamilyLink(db, token);
    return hid ? withHousehold(db, hid, tx => loadFamilyView(tx, hid),
      { isolationLevel: "repeatable read", accessMode: "read only" }) : null;
  }) : null;
  if (!view) {
    res.statusCode = 404;
    return { props: { markup: null } };
  }
  // Only the React-escaped public view reaches page props. The household state stays on the server.
  return { props: { markup: renderToStaticMarkup(<FamilyView name={view.name} state={view.state} />) } };
}) satisfies GetServerSideProps<{ markup: string | null }>;

export default function Page({ markup }: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return <>
    <Head>
      <title>Family view · Personal Economy Saver</title>
      <meta name="robots" content="noindex, nofollow" />
      <meta name="referrer" content="no-referrer" />
    </Head>
    {markup === null
      ? <main className="family-ended"><h1>This link has ended.</h1><p>Ask for a new one.</p></main>
      : <div dangerouslySetInnerHTML={{ __html: markup }} />}
  </>;
}
