const chips = ['On-device', 'Multiple profiles', 'Works offline']

export function PrivacyBand() {
  return (
    <section
      aria-labelledby="privacy-heading"
      className="mb-[120px] grid grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] items-center gap-12 border-y border-line py-[72px]"
    >
      <h2 id="privacy-heading" className="display-2 m-0">
        Your face never leaves the house.
      </h2>
      <div className="flex flex-col gap-4">
        <p className="m-0 text-[17px] leading-[1.6] text-white/72">
          Face recognition runs entirely on the mirror's Raspberry Pi. Face data is stored locally
          and never sent to our servers or any cloud. Delete it any time from the app.
        </p>
        <ul className="m-0 flex list-none flex-wrap gap-2.5 p-0">
          {chips.map((chip) => (
            <li key={chip} className="chip">
              {chip}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
