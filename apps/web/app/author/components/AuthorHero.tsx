import type { Author, TranslateFn } from "../authorPage.types";
import { getAuthorProfileDetails, getInitials } from "../authorPageUtils";

type AuthorHeroProps = {
  author: Author;
  t: TranslateFn;
};

export function AuthorHero({ author, t }: AuthorHeroProps) {
  const { primaryAffiliation, detailParts = [] } = getAuthorProfileDetails(author);

  return (
    <section className="author-hero-card">
      <div className="author-hero-header">
        <div className="author-avatar" aria-hidden="true">
          {getInitials(author.fullName)}
        </div>
        <div className="author-hero-copy">
          <h1 className="author-hero-title">{author.fullName}</h1>
          <p className="author-hero-subtitle">
            {primaryAffiliation ?? t("authors.affiliation.missing")}
          </p>
          {detailParts.length > 0 ? (
            <p className="author-hero-subtitle">{detailParts.join(" • ")}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
