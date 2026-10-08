import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import { SEO } from '../components'

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
    <div className="min-h-screen bg-void">
      <SEO
        title="About"
        description="SkyGlass is built by a military pilot and maker. A passion project that got out of hand—in the best way."
        canonical="/team"
      />
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 bg-instrument border border-amber/30 rounded-lg flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-6 h-6 text-amber" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="2" width="18" height="20" rx="2" />
                <circle cx="18" cy="5" r="1.5" fill="currentColor" />
              </svg>
            </div>
            <span className="font-display text-xl font-bold">
              <span className="text-light">Sky</span>
              <span className="text-amber">Glass</span>
            </span>
          </Link>
          <Link to="/" className="text-sm text-muted hover:text-amber transition-colors">
            ← Back to Home
          </Link>
        </div>
      </header>

      {/* Content */}
      <motion.main
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="max-w-4xl mx-auto px-6 py-16"
      >
        <div className="text-center mb-16">
          <h1 className="font-display text-4xl font-bold text-light mb-4">About</h1>
          <p className="text-lg text-muted max-w-2xl mx-auto">
            SkyGlass is a one-person operation. Built by a pilot, for pilots—and
            anyone else who appreciates well-crafted tech.
          </p>
        </div>

        {/* Founder card - single centered */}
        <div className="max-w-lg mx-auto mb-16">
          {teamMembers.map((member, index) => (
            <motion.div
              key={member.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="instrument-card p-8"
            >
              <div className="text-center">
                {/* Avatar */}
                <div className="w-24 h-24 mx-auto rounded-xl bg-amber/10 border border-amber/30 flex items-center justify-center overflow-hidden mb-6">
                  {member.image ? (
                    <img src={member.image} alt={member.name} className="w-full h-full object-cover" />
                  ) : (
                    <svg className="w-12 h-12 text-amber/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  )}
                </div>

                {/* Info */}
                <h3 className="font-display text-2xl font-bold text-light">{member.name}</h3>
                <p className="font-mono text-sm text-amber mb-4">{member.role}</p>

                {/* Pilot badges */}
                <div className="flex justify-center gap-2 mb-4">
                  {member.certificates?.map((cert) => (
                    <span key={cert} className="px-2 py-1 bg-vfr/10 border border-vfr/30 rounded text-vfr font-mono text-xs">
                      {cert}
                    </span>
                  ))}
                  {member.homeBase && (
                    <span className="px-2 py-1 bg-panel border border-border rounded text-muted font-mono text-xs">
                      {member.homeBase}
                    </span>
                  )}
                </div>

                <p className="text-muted leading-relaxed">{member.bio}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Story section */}
        <div className="instrument-card p-8 md:p-12">
          <h2 className="font-display text-2xl font-bold text-light mb-6">The Story</h2>
          <div className="space-y-4 text-muted leading-relaxed">
            <p>
              SkyGlass started the way most good projects do—late nights in the garage, a
              Raspberry Pi, and a problem worth solving. Between missions and training, I found
              myself doing the same thing every morning: checking weather on my phone, pulling up
              TFRs, reviewing the schedule. Figured there had to be a better way.
            </p>
            <p>
              The first prototype was ugly. A cheap monitor, a two-way mirror from Amazon, and
              way too much electrical tape. But it worked. Walked into the bathroom, and there
              was my weather brief, right where I was already looking. Added presence detection
              so it would sleep when I left. Then gesture control because why not.
            </p>
            <p>
              Showed it to a few squadron mates. They wanted one. Then their friends wanted one.
              Eventually I realized I could either keep building these one-off in my garage, or
              actually turn it into something other pilots and makers could build themselves.
            </p>
            <p>
              So here we are. SkyGlass is a passion project that got out of hand—in the best way.
              It's for pilots who love cool tech, makers who appreciate good hardware, and anyone
              who thinks their morning routine could use a little more flight deck energy.
            </p>
          </div>
        </div>

        {/* Contact CTA */}
        <div className="mt-12 text-center">
          <p className="text-muted mb-4">
            Questions, feedback, or just want to talk aviation and tech?
          </p>
          <a
            href="mailto:hello@skyglass.dev"
            className="inline-flex items-center gap-2 px-6 py-3 bg-amber/10 border border-amber/50 text-amber font-display text-sm uppercase tracking-wider hover:bg-amber/20 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Drop a Line
          </a>
        </div>
      </motion.main>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="max-w-4xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-muted">© {new Date().getFullYear()} SkyGlass. All rights reserved.</p>
          <div className="flex gap-6 text-sm">
            <Link to="/privacy" className="text-muted hover:text-light transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="text-muted hover:text-light transition-colors">Terms of Service</Link>
            <Link to="/team" className="text-amber">About</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
