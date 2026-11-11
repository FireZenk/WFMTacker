# Prime vault and Resurgence data sources

Checked 2026-11-11. This is a point-in-time historical dataset, not a live game API; `_asOf` records the check date for the engine's freshness control. `vaulted` is the initial removal of the ordinary relic source, not the end of a current Resurgence; owned relics and tradeable parts remain usable. `events` lists known temporary availability windows, not a complete reconstruction of every historical offering. A missing event does **not** prove that an item was never available.

## Vault entries

The [WARFRAME Wiki Prime Vault table](https://wiki.warframe.com/w/Prime_Vault) explicitly lists initial vault dates and distinguishes the previously vaulted but permanently unvaulted items. The following were checked against Digital Extremes' announcements, not derived simply by assuming all gear follows its frame:

| Initial vault date | Sets | Evidence |
| --- | --- | --- |
| 2016-05-17 | Bo | [DE: Loki, Bo, Wyrm](https://www.warframe.com/en/news/last-chance-loki-prime-void-0); wiki table |
| 2017-08-29 | Kavasa Prime Kubrow Collar | [DE: Trinity, Dual Kamas, collar](https://www.warframe.com/en/news/last-chance-for-trinity-prime); [collar wiki](https://wiki.warframe.com/w/Kavasa_Prime_Kubrow_Collar) |
| 2023-07-27 | Magnus | [DE update 33.6](https://www.warframe.com/en/patch-notes/pc/33-6-0) explicitly vaults Nidus, Strun and Magnus; wiki Vault table. The [Magnus wiki](https://wiki.warframe.com/w/Magnus_Prime) dates its introduction to 2021-09-08. An inherited 2017 vault date and 2021–22 Resurgence window were incompatible with that chronology and were removed. |
| 2025-02-12 | Larkspur, Shade | [DE Lavos hotfix](https://www.warframe.com/en/patch-notes/pc/38-0-10); wiki table |
| 2025-05-21 | Fulmin, Gunsen | [DE 38.6 forum announcement, dated May 21](https://forums.warframe.com/topic/1454869-update-386-yareli-prime/); [DE Yareli Access launch](https://www.warframe.com/en/news/yareli-prime-access); wiki table |
| 2025-08-26 | Masseter, Zylok | [DE Caliban update](https://www.warframe.com/en/patch-notes/pc/39-1-0); wiki table |
| 2025-12-10 | Acceltra, Akarius | wiki table; [DE Gauss Access](https://www.warframe.com/en/news/gauss-prime-access) identifies its weapons; [independent launch/vault chronology](https://timesaver.gg/blog/warframe-next-prime) |
| 2026-04-08 | Okina, Velox | [DE Voruna hotfix](https://www.warframe.com/en/patch-notes/pc/42-0-6); wiki table |
| 2026-06-17 | Sevagoth, Epitaph, Nautilus | [DE update 43](https://www.warframe.com/en/patch-notes/pc/43-0-0), “Items Moved To Prime Vault”; wiki table |
| 2026-09-23 | Xaku, Quassus, Trumna | [DE update 44](https://www.warframe.com/en/patch-notes/pc/44-0-0), “Items Moved To Prime Vault”; wiki table |

DE's [38.6 website patch page](https://www.warframe.com/en/patch-notes/pc/38-6-0) displays May **22**, unlike DE's May **21** forum release post, May 21 launch article and the wiki. We use May 21; the website's displayed date discrepancy remains documented rather than silently treated as independent confirmation.

Aklex (2017-01-29) and Akmagnus (2024-07-28) initial vault dates are listed both in the wiki table and [Relic Finder](https://warframerelics.com/primes/aklex-prime) ([Akmagnus](https://warframerelics.com/primes/akmagnus-prime)). Their relics are Baro Ki'Teer offerings, unlike standard Prime Access. Full Baro visit histories were not reconstructed; empty `events` are **not** evidence of continuous unavailability. The current UI cannot infer a live Baro offering: check in-game.

**Akvasto gap:** the wiki and [Relic Finder](https://warframerelics.com/primes/akvasto-prime) report 2018-11-18, but contemporary [DE material](https://www.facebook.com/PlayWarframe/videos/akvasto-prime-the-gunslingers-gift-get-axi-a5-relics-from-bounties-or-baro-kitee/576811149442517) identifies bounty drops as well as Baro, and a [2018 release account](https://www.youtube.com/watch?v=FeaylZXppgo) describes Axi A5 in the Nova/Mag unvaulting. The end of *all* initial sources on November 18 was not established. Although currently vaulted according to the wiki, the set is omitted until its first vault date and availability windows are reconciled; do not blindly equate Baro leaving with all relic sources ending.

## Permanent availability

DE [update 29.10](https://forums.warframe.com/topic/1253565-update-29100-corpus-proxima-the-new-railjack/) permanently unvaulted Nyx, Hikou, Scindo, Valkyr, Cernos, and Venka through Railjack relics. These have `availability: "permanent"`, not a present `vaulted` assertion; recorded Resurgence appearances do not revoke the permanent alternative. Braton, Burston, Fang and Lex are named evergreen by [DE's Resurgence announcement in the wiki](https://wiki.warframe.com/w/Prime_Resurgence); Akbronco, Bronco, Orthos and Paris are also listed as never vaulted in the [wiki Vault table](https://wiki.warframe.com/w/Prime_Vault). `permanent` describes availability via some continuing source, not every relic or vendor always being available. Founder exclusives and special-source items are not classified as regular vaulted sets.

## Resurgence: February–April 2026

| Start–exclusive end | Items | Evidence |
| --- | --- | --- |
| Feb 19–Mar 19 | Atlas, Tekko, Dethcube; Vauban, Akstiletto, Fragor | [DE launch](https://www.warframe.com/en/news/atlas-prime-vauban-prime-prime-resurgence) and [DE's start time](https://x.com/PlayWarframe/status/2021977752472051823); [wiki rotation history](https://wiki.warframe.com/w/Prime_Resurgence) lists the gear and end date. |
| Mar 19–Apr 16 | Nova, Soma, Vasto; Trinity, Dual Kamas, Kavasa Prime Kubrow Collar | Wiki rotation history gives dates, packs and relics; [DE announcement on Steam](https://steamcommunity.com/games/230410/announcements/detail/512986184073347518?l=english) and [contemporary independent report](https://games.gg/warframe/guides/warframe-nova-prime-returns) identify the frames, and [DE's 2020 pack](https://www.warframe.com/en/news/trinity-and-nova-prime-vault) identifies the gear. The collar is not the cosmetic Kubrow bundle: the Neo N12 and Axi S7 relics in this rotation contain its parts. |

The inherited Mar 19–Apr 16 records for Nidus, Strun, Magnus, Saryn, Spira and Nikana were removed; those six are in the October rotation, not the March wiki rotation. The inherited Feb 12–Mar 19 records for Nova, Soma and Vasto were also removed: DE's [complete 2025–26 event list](https://www.warframe.com/en/news/prime-resurgence-eoy-event-2025) does not include Nova in the February Last Chance, and Atlas/Vauban followed it. The March/April window was added instead (the collar already had it). Feb 19–Mar 19 and Mar 19–Apr 16 are recorded at date precision: the wiki gives dates, not an independently confirmed exact timestamp for both endpoints. Date-only values are interpreted as 00:00 UTC by the current engine, not as verified game-change hours.

DE's event announcement confirms the Last Chance **Feb 12 at 19:00 UTC–Feb 19 at 19:00 UTC** and the preceding Dec 18–Jan 15 and Jan 15–Feb 12 rotations at 14:00 ET (19:00 UTC, EST). The wiki lists each pair's exact equipment. In addition to the previously present Bo and Valkyr-group records, this update adds Dec–Jan and Last Chance records for Loki/Bo/Wyrm, Volt/Odonata, Mesa/Akjagara/Redeemer and Hydroid/Ballistica/Nami Skyla, plus Jan–Feb and Last Chance records for Saryn/Nikana/Spira. Existing Bo and Valkyr/Cernos/Venka records were retained rather than duplicated, with their boundaries upgraded to the confirmed 19:00 UTC time. No Baro visits were added as Resurgence.

## Resurgence: 2026-04-16 onward

The [wiki rotation history](https://wiki.warframe.com/w/Prime_Resurgence) identifies the dates and exact six item names per pack; it is cross-checked with DE's announcements below for frame names and boundary time. Paired successive starts are used as ends for completed rotations. The July 9 and June 11 boundaries are independently stated by DE; the wiki also lists the other completed boundaries. Each list below includes the corresponding Prime gear, not cosmetics.

| Start–exclusive end | Items |
| --- | --- |
| Apr 16–May 14 | Gauss, Acceltra, Akarius; Grendel, Masseter, Zylok |
| May 14–Jun 11 | Rhino, Ankyros, Boltor; Nyx, Hikou, Scindo |
| Jun 11–Jul 9 | Equinox, Stradavar, Tipedo; Wukong, Ninkondi, Zhuge |
| Jul 9–Aug 6 | Gara, Astilla, Volnus; Titania, Corinth, Pangolin |
| Aug 6–Sep 3 | Baruuk, Afuris, Cobra & Crane; Revenant, Phantasma, Tatsu |
| Sep 3–Oct 1 | Banshee, Euphona, Helios; Mirage, Akbolto, Kogake |
| Oct 1–Oct 29 | Ivara, Aksomati, Baza; Protea, Okina, Velox |
| Oct 29–unknown | Nidus, Strun, Magnus; Saryn, Spira, Nikana |

Official checks: [Gauss/Grendel launch](https://store.steampowered.com/news/app/230410/view/637963704478990634), [Nyx/Rhino](https://www.facebook.com/PlayWarframe/posts/bend-minds-and-break-everything-else-with-the-next-prime-resurgence-rotation-nyx/1499224514907665), [Equinox/Wukong](https://x.com/PlayWarframe/status/2060089271583752596), [Gara/Titania](https://x.com/PlayWarframe/status/2070205498641531369), [Baruuk/Revenant](https://www.facebook.com/PlayWarframe/posts/find-inner-peace-and-then-embrace-the-chaos-baruuk-prime-and-revenant-prime-retu/1570010111162438), [Banshee/Mirage](https://x.com/PlayWarframe/status/2092700312662405488), [Ivara/Protea](https://x.com/PlayWarframe/status/2103182771900305471), [Nidus/Saryn start](https://x.com/PlayWarframe/status/2113344724882886983), and [current official offering](https://www.warframe.com/en/prime-resurgence) with all six current items.

All these starts and completed ends are recorded at 14:00 America/New_York, with exclusive ends. The listed boundaries through October 29 fall during EDT (UTC−04), so are `18:00:00Z`. Do not assume 18:00 UTC year-round: 14:00 ET is 19:00 UTC in EST, and special events can differ. The wiki describes a normal 28-day cadence at 18:00 UTC, but that cadence is not proof of a specific announced ET time.

For Nidus/Saryn, DE's currently visible page confirms the six items and the start but did not confirm an end at this check. The wiki gives November 25, while another source describes November 25–26 as approximate; neither establishes a sufficiently corroborated exact official boundary. Each of the six therefore uses `end: null` and `verifiedAt: "2026-11-11"`; this is an observation date, not a predicted end or a guarantee of continuing availability. Refresh the observation or close the window only after checking a reliable source. A consumer must not turn a stale open-ended observation into a confident current status.

## Earlier history and known gaps

* Wisp/Fulmin/Gunsen and Hildryn/Larkspur/Shade were offered 2025-11-20–2025-12-18 according to the wiki rotation table. Bo's copied historical windows follow the Loki/Volt table and DE's [2025–26 end-of-year event](https://www.warframe.com/en/news/prime-resurgence-eoy-event-2025).
* Kavasa collar is distinct from the cosmetic Kavasa Kubrow Bundle. Its 2020 window is documented on the collar wiki; Neo N12 and Axi S7 contain collar parts and are listed in the Nova/Trinity 2026-03-19–04-16 rotation. Additional older collar windows have not been exhaustively audited.
* Apart from the specifically identified corrections above, existing date-only history was preserved as supplied, including its original precision and any legacy approximations; it was not independently audited or upgraded to an exact time. In particular, some older companion dates differ from the wiki: the existing Gara date is 2023-03-15 but Astilla and Volnus are 2023-03-28, while the wiki says March 15 for all three. No silent correction was made; reconcile against primary evidence separately.
* Older inherited Nidus/Strun/Magnus windows on 2024-02-01–02-15 and 2024-09-26–10-24 are **unverified and suspect**: DE's [2023–24 event announcement](https://www.warframe.com/en/news/prime-resurgence-event-coming-soon) lists the February Last Chance frames without Nidus, and DE's [October 2024 news](https://www.warframe.com/en/news/the-sentinel-10152024) identifies the concurrent rotation as Nova/Trinity, not Nidus/Saryn. Saryn/Nikana/Spira also inherit the latter window. The wiki rotation table gives Saryn/Valkyr from 2024-01-18, earlier than the inherited 2024-02-01 start. These older inherited windows were not silently rewritten in this scoped correction; they need a separate audit, including possible special offerings.
* Protea and Caliban were temporarily obtainable via Vanguard relics in the [2025 year-end event](https://www.warframe.com/en/news/prime-resurgence-eoy-event-2025) **before** their vaulting; Vanguard coverage was not reconstructed here. Caliban is not asserted vaulted. Current ordinary Prime Access items are not added as vaulted merely because a new Prime is expected.
* The 2026 wiki table also mentions later Baro availability for Volt, Odonata and other items. Those Baro windows, other older rotations, and special/exalted/robotic items without a verified market-set identity are outside this update and require separate verification.
