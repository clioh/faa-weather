import { PageHeader, SEO, SiteFooter } from '../components'

const teamMembers = [
  {
    name: 'The Founder',
    role: 'Military Pilot & Maker',
    bio: 'Active duty fighter pilot by day, hardware hacker by night. Built SkyGlass in the garage because the best projects come from scratching your own itch. Now shipping kits to fellow pilots and tinkerers who appreciate good tech.',
    certificates: ['MIL', 'ATP'],
    homeBase: 'KLSV',
    image: null,
    links: {
      twitter: null,
      github: null,
      linkedin: null,
    },
  },
]

export function Team() {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <SEO
        title="About"
        description="SkyGlass is built by a military pilot and maker. A passion project that got out of hand—in the best way."
        canonical="/team"
      />

      <PageHeader />

      <main className="page-container pt-10 pb-24 sm:pt-16">
        <h1 className="display-3">About</h1>
        <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-fg-2">
          SkyGlass is a one-person operation. Built by a pilot, for pilots—and anyone else who
          appreciates well-crafted tech.
        </p>

        <ul className="mt-12 border-t border-line" aria-label="Team">
          {teamMembers.map((member) => (
            <li
              key={member.name}
              className="flex flex-col gap-5 border-b border-line py-8 sm:flex-row sm:gap-6"
            >
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line-strong">
                {member.image ? (
                  <img
                    src={member.image}
                    alt={member.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <svg
                    className="h-7 w-7 text-fg-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                )}
              </div>

              <div className="min-w-0">
                <h2 className="text-2xl font-light tracking-tight text-fg">{member.name}</h2>
                <p className="mt-1 text-sm text-fg-2">{member.role}</p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {member.certificates?.map((cert) => (
                    <span key={cert} className="chip">
                      {cert}
                    </span>
                  ))}
                  {member.homeBase && <span className="chip">{member.homeBase}</span>}
                </div>

                <p className="mt-4 text-[15px] leading-relaxed text-fg-2">{member.bio}</p>
              </div>
            </li>
          ))}
        </ul>

        <section className="prose-site">
          <h2>The Story</h2>
          <p>
            SkyGlass started the way most good projects do—late nights in the garage, a Raspberry
            Pi, and a problem worth solving. Between missions and training, I found myself doing the
            same thing every morning: checking weather on my phone, pulling up TFRs, reviewing the
            schedule. Figured there had to be a better way.
          </p>
          <p>
            The first prototype was ugly. A cheap monitor, a two-way mirror from Amazon, and way too
            much electrical tape. But it worked. Walked into the bathroom, and there was my weather
            brief, right where I was already looking. Added presence detection so it would sleep
            when I left. Then gesture control because why not.
          </p>
          <p>
            Showed it to a few squadron mates. They wanted one. Then their friends wanted one.
            Eventually I realized I could either keep building these one-off in my garage, or
            actually turn it into something other pilots and makers could build themselves.
          </p>
          <p>
            So here we are. SkyGlass is a passion project that got out of hand—in the best way. It's
            for pilots who love cool tech, makers who appreciate good hardware, and anyone who
            thinks their morning routine could use a little more flight deck energy.
          </p>
        </section>

        <div className="mt-16 border-t border-line pt-10">
          <p className="text-[15px] text-fg-2">
            Questions, feedback, or just want to talk aviation and tech?
          </p>
          <a href="mailto:hello@skyglass.dev" className="btn btn-secondary mt-5">
            Drop a Line
          </a>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
