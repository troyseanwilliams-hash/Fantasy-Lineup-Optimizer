import { useEffect } from "react";

const BASE_TITLE = "EliteLineup AI";
const BASE_URL = "https://fantasy-lineup-optimizer.replit.app";

interface PageMeta {
  title: string;
  description?: string;
  path?: string;
}

export function usePageMeta({ title, description, path }: PageMeta) {
  useEffect(() => {
    const fullTitle = title === BASE_TITLE ? title : `${title} | ${BASE_TITLE}`;
    document.title = fullTitle;

    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc && description) {
      metaDesc.setAttribute("content", description);
    }

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", fullTitle);

    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc && description) ogDesc.setAttribute("content", description);

    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl && path) ogUrl.setAttribute("content", `${BASE_URL}${path}`);

    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical && path) canonical.setAttribute("href", `${BASE_URL}${path}`);

    const twitterTitle = document.querySelector('meta[name="twitter:title"]');
    if (twitterTitle) twitterTitle.setAttribute("content", fullTitle);

    const twitterDesc = document.querySelector('meta[name="twitter:description"]');
    if (twitterDesc && description) twitterDesc.setAttribute("content", description);
  }, [title, description, path]);
}
