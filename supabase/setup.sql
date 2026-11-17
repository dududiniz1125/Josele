-- Josele database setup for Supabase.
-- GENERATED FILE: edit supabase/template.sql and run `node scripts/build-sql.js`.
--
-- How to use: Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
-- It is safe to run again (for example after the word lists change).
--
-- Security model: the browser can never write to these tables directly.
-- Row-level security is on and no table privileges are granted, so the only way
-- in is through the functions below, which always act as the signed-in player
-- (auth.uid()) and re-check every submitted result on the server.

-- ---------------------------------------------------------------- tables

create extension if not exists pgcrypto with schema extensions;

-- A player is either a guest (no username) or an account (username + password).
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  current_streak integer not null default 0,
  best_streak integer not null default 0,
  last_solved date,
  created_at timestamptz not null default now()
);
-- Upgrade from the first version, where a player row was tied to one browser.
alter table public.players drop constraint if exists players_id_fkey;
alter table public.players alter column id set default gen_random_uuid();
alter table public.players add column if not exists username text;
alter table public.players add column if not exists pass_hash text;
create unique index if not exists players_username_unique on public.players (lower(username));

create table if not exists public.results (
  player_id uuid not null references public.players (id) on delete cascade,
  day date not null,
  steps integer not null,
  optimal integer not null,
  path text[] not null,
  finished_at timestamptz not null default now(),
  primary key (player_id, day)
);
create index if not exists results_day_rank on public.results (day, steps, finished_at);

-- Which player each browser (an anonymous Supabase session) is playing as.
-- Logging in points the browser at the account's player; logging out removes the row.
create table if not exists public.player_links (
  auth_uid uuid primary key references auth.users (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade
);
create index if not exists player_links_player on public.player_links (player_id);
insert into public.player_links (auth_uid, player_id)
select p.id, p.id from public.players p join auth.users u on u.id = p.id
on conflict (auth_uid) do nothing;

-- Failed log-in attempts, to slow down password guessing.
create table if not exists public.login_attempts (
  username text not null,
  at timestamptz not null default now()
);
create index if not exists login_attempts_recent on public.login_attempts (username, at);

create table if not exists public.valid_words (word text primary key);
create table if not exists public.start_words (
  idx integer primary key,
  word text not null,
  optimal integer not null
);

-- Left over from the first version (Google / email log-in).
drop function if exists public.create_merge_token();
drop function if exists public.claim_guest(uuid);
drop function if exists public.josele_is_guest();
drop table if exists public.merge_tokens;

alter table public.players enable row level security;
alter table public.results enable row level security;
alter table public.player_links enable row level security;
alter table public.login_attempts enable row level security;
alter table public.valid_words enable row level security;
alter table public.start_words enable row level security;

revoke all on public.players, public.results, public.player_links, public.login_attempts,
  public.valid_words, public.start_words from anon, authenticated;

-- There are deliberately no policies at all: with row-level security on and no
-- policy, direct reads and writes are refused even if a privilege is granted by
-- mistake. Everything goes through the functions below.
drop policy if exists "players read own row" on public.players;
drop policy if exists "players read own results" on public.results;

-- ---------------------------------------------------------------- word lists

truncate public.valid_words;
insert into public.valid_words (word) values
('ABAS'), ('ABBA'), ('ABED'), ('ABET'), ('ABLE'), ('ABLY'), ('ABRI'), ('ABUT'), ('ACED'), ('ACES'), ('ACHE'), ('ACHY'),
('ACID'), ('ACME'), ('ACNE'), ('ACRE'), ('ACTS'), ('ACYL'), ('ADDS'), ('ADIT'), ('ADZE'), ('AEON'), ('AERO'), ('AFAR'),
('AGAR'), ('AGED'), ('AGEE'), ('AGES'), ('AGHA'), ('AGIO'), ('AGMA'), ('AGOG'), ('AGON'), ('AGUE'), ('AHEM'), ('AHOY'),
('AIDE'), ('AIDS'), ('AILS'), ('AIMS'), ('AIRS'), ('AIRT'), ('AIRY'), ('AJAR'), ('AKEE'), ('AKIN'), ('ALAE'), ('ALAR'),
('ALAS'), ('ALBA'), ('ALBS'), ('ALEE'), ('ALES'), ('ALGA'), ('ALKY'), ('ALLY'), ('ALMS'), ('ALOE'), ('ALOW'), ('ALPS'),
('ALSO'), ('ALTO'), ('ALUM'), ('AMAH'), ('AMBO'), ('AMEN'), ('AMID'), ('AMIE'), ('AMMO'), ('AMOK'), ('AMPS'), ('AMYL'),
('ANAL'), ('ANAS'), ('ANEW'), ('ANIL'), ('ANIS'), ('ANKH'), ('ANNA'), ('ANOA'), ('ANON'), ('ANTA'), ('ANTE'), ('ANTI'),
('ANTS'), ('ANUS'), ('APED'), ('APES'), ('APEX'), ('APPS'), ('APSE'), ('AQUA'), ('ARAK'), ('ARBS'), ('ARCH'), ('ARCS'),
('AREA'), ('ARES'), ('ARIA'), ('ARID'), ('ARIL'), ('ARKS'), ('ARMS'), ('ARMY'), ('ARSE'), ('ARTS'), ('ARTY'), ('ARUM'),
('ARVO'), ('ARYL'), ('ASCI'), ('ASHY'), ('ASKS'), ('ASPS'), ('ATOM'), ('ATOP'), ('AUKS'), ('AUNT'), ('AURA'), ('AUTO'),
('AVER'), ('AVID'), ('AVOS'), ('AVOW'), ('AWAY'), ('AWED'), ('AWES'), ('AWLS'), ('AWNS'), ('AWRY'), ('AXED'), ('AXES'),
('AXIL'), ('AXIS'), ('AXLE'), ('AXON'), ('AYAH'), ('AYES'), ('AYIN'), ('AZAN'), ('BAAS'), ('BABA'), ('BABE'), ('BABY'),
('BACH'), ('BACK'), ('BADE'), ('BAEL'), ('BAGS'), ('BAHT'), ('BAIL'), ('BAIT'), ('BAKE'), ('BALD'), ('BALE'), ('BALK'),
('BALL'), ('BALM'), ('BANC'), ('BAND'), ('BANE'), ('BANG'), ('BANI'), ('BANK'), ('BANS'), ('BANT'), ('BAPS'), ('BARB'),
('BARD'), ('BARE'), ('BARF'), ('BARK'), ('BARM'), ('BARN'), ('BARS'), ('BASE'), ('BASH'), ('BASK'), ('BASS'), ('BAST'),
('BATE'), ('BATH'), ('BATS'), ('BATT'), ('BAUD'), ('BAWD'), ('BAWL'), ('BAYS'), ('BEAD'), ('BEAK'), ('BEAM'), ('BEAN'),
('BEAR'), ('BEAT'), ('BEAU'), ('BECK'), ('BEDS'), ('BEEF'), ('BEEN'), ('BEEP'), ('BEER'), ('BEES'), ('BEET'), ('BEGS'),
('BELL'), ('BELS'), ('BELT'), ('BEMA'), ('BEND'), ('BENS'), ('BENT'), ('BERG'), ('BERK'), ('BERM'), ('BEST'), ('BETA'),
('BETH'), ('BETS'), ('BEVY'), ('BEYS'), ('BIAS'), ('BIBB'), ('BIBS'), ('BICE'), ('BIDE'), ('BIDS'), ('BIER'), ('BIFF'),
('BIKE'), ('BILE'), ('BILK'), ('BILL'), ('BIND'), ('BINE'), ('BINS'), ('BIOS'), ('BIRD'), ('BIRL'), ('BIRR'), ('BISE'),
('BISK'), ('BITE'), ('BITS'), ('BITT'), ('BIZE'), ('BLAB'), ('BLAG'), ('BLAH'), ('BLAT'), ('BLEB'), ('BLED'), ('BLEW'),
('BLIP'), ('BLOB'), ('BLOC'), ('BLOG'), ('BLOT'), ('BLOW'), ('BLUE'), ('BLUR'), ('BOAR'), ('BOAS'), ('BOAT'), ('BOBS'),
('BOCK'), ('BODE'), ('BODS'), ('BODY'), ('BOGS'), ('BOIL'), ('BOLA'), ('BOLD'), ('BOLE'), ('BOLL'), ('BOLO'), ('BOLT'),
('BOMB'), ('BOND'), ('BONE'), ('BONG'), ('BONK'), ('BONY'), ('BOOB'), ('BOOK'), ('BOOM'), ('BOON'), ('BOOR'), ('BOOS'),
('BOOT'), ('BOPS'), ('BORA'), ('BORE'), ('BORG'), ('BORN'), ('BORT'), ('BOSH'), ('BOSK'), ('BOSS'), ('BOTH'), ('BOTS'),
('BOTT'), ('BOUR'), ('BOUT'), ('BOWL'), ('BOWS'), ('BOXY'), ('BOYS'), ('BOZO'), ('BRAD'), ('BRAE'), ('BRAG'), ('BRAN'),
('BRAS'), ('BRAT'), ('BRAW'), ('BRAY'), ('BRED'), ('BREE'), ('BREI'), ('BREW'), ('BRIE'), ('BRIG'), ('BRIM'), ('BRIO'),
('BRIS'), ('BRIT'), ('BROW'), ('BRUT'), ('BUBO'), ('BUBS'), ('BUCK'), ('BUDS'), ('BUFF'), ('BUGS'), ('BUHL'), ('BUHR'),
('BULB'), ('BULK'), ('BULL'), ('BUMF'), ('BUMP'), ('BUMS'), ('BUND'), ('BUNG'), ('BUNK'), ('BUNS'), ('BUNT'), ('BUOY'),
('BURG'), ('BURL'), ('BURN'), ('BURP'), ('BURR'), ('BURS'), ('BURY'), ('BUSH'), ('BUSK'), ('BUSS'), ('BUST'), ('BUSY'),
('BUTS'), ('BUTT'), ('BUYS'), ('BUZZ'), ('BYES'), ('BYRE'), ('BYTE'), ('CABS'), ('CADE'), ('CADI'), ('CADS'), ('CAFF'),
('CAGE'), ('CAIN'), ('CAKE'), ('CAKY'), ('CALF'), ('CALK'), ('CALL'), ('CALM'), ('CALX'), ('CAME'), ('CAMP'), ('CAMS'),
('CANE'), ('CANS'), ('CANT'), ('CAPE'), ('CAPO'), ('CAPS'), ('CARD'), ('CARE'), ('CARK'), ('CARL'), ('CARP'), ('CARS'),
('CART'), ('CASA'), ('CASE'), ('CASH'), ('CASK'), ('CAST'), ('CATE'), ('CATS'), ('CAUL'), ('CAVE'), ('CAVY'), ('CAWS'),
('CAYS'), ('CECA'), ('CEDE'), ('CEDI'), ('CEIL'), ('CELL'), ('CELT'), ('CENT'), ('CERE'), ('CERO'), ('CESS'), ('CHAD'),
('CHAM'), ('CHAP'), ('CHAR'), ('CHAT'), ('CHAW'), ('CHEF'), ('CHEW'), ('CHEZ'), ('CHIC'), ('CHIN'), ('CHIP'), ('CHIS'),
('CHIT'), ('CHOC'), ('CHON'), ('CHOP'), ('CHOU'), ('CHOW'), ('CHUB'), ('CHUG'), ('CHUM'), ('CIAO'), ('CINE'), ('CION'),
('CIST'), ('CITE'), ('CITY'), ('CLAD'), ('CLAM'), ('CLAN'), ('CLAP'), ('CLAW'), ('CLAY'), ('CLEF'), ('CLEM'), ('CLEW'),
('CLIP'), ('CLIT'), ('CLOD'), ('CLOG'), ('CLOP'), ('CLOS'), ('CLOT'), ('CLOY'), ('CLUB'), ('CLUE'), ('COAL'), ('COAT'),
('COAX'), ('COBS'), ('COCA'), ('COCK'), ('COCO'), ('CODA'), ('CODE'), ('CODS'), ('COED'), ('COFF'), ('COGS'), ('COHO'),
('COIF'), ('COIL'), ('COIN'), ('COIR'), ('COKE'), ('COLA'), ('COLD'), ('COLE'), ('COLI'), ('COLS'), ('COLT'), ('COLY'),
('COMA'), ('COMB'), ('COME'), ('CONE'), ('CONK'), ('CONN'), ('CONS'), ('CONY'), ('COOK'), ('COOL'), ('COOM'), ('COON'),
('COOP'), ('COOS'), ('COOT'), ('COPE'), ('COPS'), ('COPY'), ('CORD'), ('CORE'), ('CORF'), ('CORK'), ('CORM'), ('CORN'),
('COSH'), ('COSS'), ('COST'), ('COSY'), ('COTE'), ('COTH'), ('COTS'), ('COUP'), ('COVE'), ('COWL'), ('COWS'), ('COXA'),
('COZE'), ('COZY'), ('CRAB'), ('CRAG'), ('CRAM'), ('CRAP'), ('CRAW'), ('CRED'), ('CREE'), ('CREW'), ('CRIB'), ('CROP'),
('CROW'), ('CRUD'), ('CRUS'), ('CRUX'), ('CSCH'), ('CUBE'), ('CUBS'), ('CUDS'), ('CUED'), ('CUES'), ('CUFF'), ('CUKE'),
('CULL'), ('CULM'), ('CULT'), ('CUMS'), ('CUNT'), ('CUPS'), ('CURB'), ('CURD'), ('CURE'), ('CURL'), ('CURS'), ('CURT'),
('CUSK'), ('CUSP'), ('CUSS'), ('CUTE'), ('CUTS'), ('CWMS'), ('CYAN'), ('CYMA'), ('CYME'), ('CYST'), ('CZAR'), ('DABS'),
('DACE'), ('DADA'), ('DADO'), ('DADS'), ('DAFF'), ('DAFT'), ('DAGO'), ('DAGS'), ('DAHL'), ('DAHS'), ('DAIS'), ('DAKS'),
('DALE'), ('DAME'), ('DAMN'), ('DAMP'), ('DAMS'), ('DANG'), ('DANK'), ('DARE'), ('DARG'), ('DARK'), ('DARN'), ('DART'),
('DASH'), ('DATA'), ('DATE'), ('DATO'), ('DAUB'), ('DAWN'), ('DAWS'), ('DAYS'), ('DAZE'), ('DEAD'), ('DEAF'), ('DEAL'),
('DEAN'), ('DEAR'), ('DEBS'), ('DEBT'), ('DECK'), ('DECO'), ('DEED'), ('DEEM'), ('DEEP'), ('DEER'), ('DEFT'), ('DEFY'),
('DEIL'), ('DELE'), ('DELI'), ('DELL'), ('DEME'), ('DEMO'), ('DEMY'), ('DENE'), ('DENS'), ('DENT'), ('DENY'), ('DERV'),
('DESK'), ('DEVA'), ('DEWS'), ('DEWY'), ('DHOW'), ('DIAL'), ('DIBS'), ('DICE'), ('DICK'), ('DIDO'), ('DIED'), ('DIES'),
('DIET'), ('DIGS'), ('DIKE'), ('DILL'), ('DIME'), ('DIMS'), ('DINE'), ('DING'), ('DINK'), ('DINS'), ('DINT'), ('DIPS'),
('DIRE'), ('DIRK'), ('DIRT'), ('DISC'), ('DISH'), ('DISK'), ('DITS'), ('DITZ'), ('DIVA'), ('DIVE'), ('DOBS'), ('DOCK'),
('DOCS'), ('DODO'), ('DOER'), ('DOES'), ('DOFF'), ('DOGE'), ('DOGS'), ('DOIT'), ('DOLE'), ('DOLL'), ('DOLS'), ('DOLT'),
('DOME'), ('DONA'), ('DONE'), ('DONG'), ('DONS'), ('DOOM'), ('DOOR'), ('DOPA'), ('DOPE'), ('DORA'), ('DORK'), ('DORM'),
('DORP'), ('DORY'), ('DOSE'), ('DOSH'), ('DOSS'), ('DOST'), ('DOTE'), ('DOTH'), ('DOTS'), ('DOUR'), ('DOVE'), ('DOWN'),
('DOXY'), ('DOZE'), ('DOZY'), ('DRAB'), ('DRAG'), ('DRAM'), ('DRAT'), ('DRAW'), ('DRAY'), ('DREE'), ('DREG'), ('DREW'),
('DRIP'), ('DROP'), ('DRUB'), ('DRUG'), ('DRUM'), ('DRYS'), ('DUAD'), ('DUAL'), ('DUBS'), ('DUCE'), ('DUCK'), ('DUCT'),
('DUDE'), ('DUDS'), ('DUEL'), ('DUES'), ('DUET'), ('DUFF'), ('DUKE'), ('DULL'), ('DULY'), ('DUMA'), ('DUMB'), ('DUMP'),
('DUNE'), ('DUNG'), ('DUNK'), ('DUNS'), ('DUNT'), ('DUOS'), ('DUPE'), ('DURO'), ('DUSK'), ('DUST'), ('DUTY'), ('DYAD'),
('DYED'), ('DYER'), ('DYES'), ('DYKE'), ('DYNE'), ('EACH'), ('EARL'), ('EARN'), ('EARS'), ('EASE'), ('EAST'), ('EASY'),
('EATS'), ('EAVE'), ('EBBS'), ('EBON'), ('ECHO'), ('ECHT'), ('ECRU'), ('ECUS'), ('EDDO'), ('EDDY'), ('EDGE'), ('EDGY'),
('EDIT'), ('EELS'), ('EFFS'), ('EFTS'), ('EGAD'), ('EGGS'), ('EGOS'), ('EIDE'), ('EKED'), ('EKES'), ('ELKS'), ('ELLS'),
('ELMS'), ('ELSE'), ('EMFS'), ('EMIR'), ('EMIT'), ('EMOS'), ('EMUS'), ('ENDS'), ('ENOL'), ('ENOW'), ('ENVY'), ('EONS'),
('EPIC'), ('EPOS'), ('ERAS'), ('ERGO'), ('ERGS'), ('ERNE'), ('ERRS'), ('ERSH'), ('ERST'), ('ESPY'), ('ESSE'), ('ETAS'),
('ETCH'), ('ETNA'), ('EURO'), ('EVEN'), ('EVER'), ('EVES'), ('EVIL'), ('EWER'), ('EWES'), ('EXAM'), ('EXEC'), ('EXES'),
('EXIT'), ('EXON'), ('EXPO'), ('EYAS'), ('EYED'), ('EYER'), ('EYES'), ('EYOT'), ('EYRA'), ('EYRE'), ('FACE'), ('FACT'),
('FADE'), ('FADO'), ('FADS'), ('FAFF'), ('FAGS'), ('FAIL'), ('FAIN'), ('FAIR'), ('FAKE'), ('FALL'), ('FAME'), ('FANE'),
('FANG'), ('FANS'), ('FARD'), ('FARE'), ('FARL'), ('FARM'), ('FARO'), ('FART'), ('FASH'), ('FAST'), ('FATE'), ('FATS'),
('FAUN'), ('FAUX'), ('FAVE'), ('FAWN'), ('FAYS'), ('FAZE'), ('FEAL'), ('FEAR'), ('FEAT'), ('FECK'), ('FEDS'), ('FEED'),
('FEEL'), ('FEER'), ('FEES'), ('FEET'), ('FELL'), ('FELT'), ('FEME'), ('FEND'), ('FENS'), ('FERE'), ('FERN'), ('FESS'),
('FEST'), ('FETA'), ('FEUD'), ('FIAT'), ('FIBS'), ('FICO'), ('FIEF'), ('FIFE'), ('FIGS'), ('FILA'), ('FILE'), ('FILL'),
('FILM'), ('FILO'), ('FILS'), ('FIND'), ('FINE'), ('FINK'), ('FINO'), ('FINS'), ('FIRE'), ('FIRM'), ('FIRN'), ('FIRS'),
('FISC'), ('FISH'), ('FIST'), ('FITS'), ('FIVE'), ('FIZZ'), ('FLAB'), ('FLAG'), ('FLAK'), ('FLAM'), ('FLAN'), ('FLAP'),
('FLAT'), ('FLAW'), ('FLAX'), ('FLAY'), ('FLEA'), ('FLED'), ('FLEE'), ('FLEW'), ('FLEX'), ('FLEY'), ('FLIP'), ('FLIT'),
('FLOC'), ('FLOE'), ('FLOG'), ('FLOP'), ('FLOW'), ('FLUB'), ('FLUE'), ('FLUX'), ('FOAL'), ('FOAM'), ('FOBS'), ('FOES'),
('FOGS'), ('FOGY'), ('FOIL'), ('FOIN'), ('FOLD'), ('FOLK'), ('FOND'), ('FONT'), ('FOOD'), ('FOOL'), ('FOOT'), ('FOPS'),
('FORB'), ('FORD'), ('FORE'), ('FORK'), ('FORM'), ('FORT'), ('FOUL'), ('FOUR'), ('FOWL'), ('FOXY'), ('FRAE'), ('FRAG'),
('FRAP'), ('FRAT'), ('FRAY'), ('FREE'), ('FRET'), ('FRIG'), ('FRIT'), ('FROE'), ('FROG'), ('FROM'), ('FROW'), ('FRUG'),
('FUCK'), ('FUEL'), ('FUGS'), ('FULL'), ('FUME'), ('FUMY'), ('FUND'), ('FUNK'), ('FURL'), ('FURS'), ('FURY'), ('FUSE'),
('FUSS'), ('FUTZ'), ('FUZZ'), ('FYKE'), ('FYRD'), ('GABS'), ('GABY'), ('GADS'), ('GAFF'), ('GAGA'), ('GAGS'), ('GAIN'),
('GAIT'), ('GALA'), ('GALE'), ('GALL'), ('GALS'), ('GAMB'), ('GAME'), ('GAMP'), ('GAMY'), ('GANG'), ('GAPE'), ('GAPS'),
('GARB'), ('GARS'), ('GASH'), ('GASP'), ('GATE'), ('GATS'), ('GAUD'), ('GAUR'), ('GAVE'), ('GAWD'), ('GAWK'), ('GAWP'),
('GAYS'), ('GAZE'), ('GEAN'), ('GEAR'), ('GEED'), ('GEEK'), ('GEES'), ('GELD'), ('GELS'), ('GEMS'), ('GENE'), ('GENS'),
('GENT'), ('GENU'), ('GERM'), ('GEST'), ('GETS'), ('GEUM'), ('GHAT'), ('GHEE'), ('GIBE'), ('GIFT'), ('GIGS'), ('GILD'),
('GILL'), ('GILT'), ('GIMP'), ('GINK'), ('GINS'), ('GIRD'), ('GIRL'), ('GIRO'), ('GIRT'), ('GIST'), ('GITE'), ('GITS'),
('GIVE'), ('GLAD'), ('GLAM'), ('GLEE'), ('GLEN'), ('GLEY'), ('GLIA'), ('GLIB'), ('GLIM'), ('GLOB'), ('GLOM'), ('GLOP'),
('GLOW'), ('GLUE'), ('GLUM'), ('GLUT'), ('GNAT'), ('GNAW'), ('GNUS'), ('GOAD'), ('GOAL'), ('GOAT'), ('GOBO'), ('GOBS'),
('GOBY'), ('GODS'), ('GOER'), ('GOES'), ('GOEY'), ('GOLD'), ('GOLF'), ('GONE'), ('GONG'), ('GOOD'), ('GOOF'), ('GOOK'),
('GOON'), ('GOOP'), ('GORE'), ('GORP'), ('GORY'), ('GOSH'), ('GOTH'), ('GOUT'), ('GOWK'), ('GOWN'), ('GOYS'), ('GRAB'),
('GRAD'), ('GRAM'), ('GRAN'), ('GRAY'), ('GREE'), ('GREW'), ('GREY'), ('GRID'), ('GRIG'), ('GRIM'), ('GRIN'), ('GRIP'),
('GRIT'), ('GROG'), ('GROT'), ('GROW'), ('GRUB'), ('GRUM'), ('GUAN'), ('GUCK'), ('GUFF'), ('GUIB'), ('GULA'), ('GULF'),
('GULL'), ('GULP'), ('GUMS'), ('GUNK'), ('GUNS'), ('GURU'), ('GUSH'), ('GUST'), ('GUTS'), ('GUVS'), ('GUYS'), ('GYBE'),
('GYMS'), ('GYPS'), ('GYRE'), ('GYRO'), ('GYVE'), ('HAAF'), ('HAAR'), ('HACK'), ('HADE'), ('HAEM'), ('HAFT'), ('HAGS'),
('HAIK'), ('HAIL'), ('HAIR'), ('HAJJ'), ('HAKE'), ('HAKU'), ('HALE'), ('HALF'), ('HALL'), ('HALM'), ('HALO'), ('HALT'),
('HAME'), ('HAMS'), ('HAND'), ('HANG'), ('HANK'), ('HARD'), ('HARE'), ('HARK'), ('HARL'), ('HARM'), ('HARP'), ('HART'),
('HASH'), ('HASP'), ('HAST'), ('HATE'), ('HATH'), ('HATS'), ('HAUL'), ('HAVE'), ('HAWK'), ('HAWS'), ('HAYS'), ('HAZE'),
('HAZY'), ('HEAD'), ('HEAL'), ('HEAP'), ('HEAR'), ('HEAT'), ('HECK'), ('HEED'), ('HEEL'), ('HEFT'), ('HEIR'), ('HELD'),
('HELL'), ('HELM'), ('HELP'), ('HEME'), ('HEMP'), ('HEMS'), ('HENS'), ('HENT'), ('HERB'), ('HERD'), ('HERE'), ('HERL'),
('HERM'), ('HERN'), ('HERO'), ('HERS'), ('HEST'), ('HETH'), ('HEWS'), ('HICK'), ('HIDE'), ('HIED'), ('HIES'), ('HIGH'),
('HIKE'), ('HILA'), ('HILL'), ('HILT'), ('HIMS'), ('HIND'), ('HINS'), ('HINT'), ('HIPS'), ('HIRE'), ('HISS'), ('HITS'),
('HIVE'), ('HIYA'), ('HOAR'), ('HOAX'), ('HOBO'), ('HOBS'), ('HOCK'), ('HODS'), ('HOED'), ('HOER'), ('HOES'), ('HOGS'),
('HOKE'), ('HOLD'), ('HOLE'), ('HOLM'), ('HOLP'), ('HOLS'), ('HOLT'), ('HOLY'), ('HOME'), ('HOMO'), ('HONE'), ('HONG'),
('HONK'), ('HONS'), ('HOOD'), ('HOOF'), ('HOOK'), ('HOOP'), ('HOOT'), ('HOPE'), ('HOPS'), ('HORA'), ('HORN'), ('HOSE'),
('HOST'), ('HOTS'), ('HOUR'), ('HOVE'), ('HOWL'), ('HOWS'), ('HOYS'), ('HUBS'), ('HUED'), ('HUES'), ('HUFF'), ('HUGE'),
('HUGS'), ('HULA'), ('HULK'), ('HULL'), ('HUMP'), ('HUMS'), ('HUNG'), ('HUNK'), ('HUNT'), ('HURL'), ('HURT'), ('HUSH'),
('HUSK'), ('HUTS'), ('HWAN'), ('HYLA'), ('HYMN'), ('HYPE'), ('HYPO'), ('IAMB'), ('IBEX'), ('IBIS'), ('ICED'), ('ICES'),
('ICKY'), ('ICON'), ('IDEA'), ('IDEM'), ('IDES'), ('IDLE'), ('IDLY'), ('IDOL'), ('IFFY'), ('ILEA'), ('ILEX'), ('ILIA'),
('ILKS'), ('ILLS'), ('IMAM'), ('IMPI'), ('IMPS'), ('INCH'), ('INFO'), ('INKS'), ('INKY'), ('INLY'), ('INNS'), ('INTI'),
('INTO'), ('IONS'), ('IOTA'), ('IRIS'), ('IRKS'), ('IRON'), ('ISLE'), ('ISMS'), ('ITCH'), ('ITEM'), ('IWIS'), ('IXIA'),
('JABS'), ('JACK'), ('JADE'), ('JAGS'), ('JAIL'), ('JAMB'), ('JAMS'), ('JANE'), ('JAPE'), ('JARL'), ('JARS'), ('JATO'),
('JAVA'), ('JAWS'), ('JAYS'), ('JAZZ'), ('JEAN'), ('JEEP'), ('JEER'), ('JEEZ'), ('JEFE'), ('JEHU'), ('JELL'), ('JERK'),
('JESS'), ('JEST'), ('JETS'), ('JIBE'), ('JIBS'), ('JIFF'), ('JIGS'), ('JILL'), ('JILT'), ('JINK'), ('JINN'), ('JINX'),
('JIVA'), ('JIVE'), ('JIVY'), ('JOBS'), ('JOCK'), ('JOEY'), ('JOGS'), ('JOHN'), ('JOIN'), ('JOKE'), ('JOLT'), ('JOOK'),
('JOSE'), ('JOSH'), ('JOSS'), ('JOTA'), ('JOTS'), ('JOWL'), ('JOYS'), ('JUBA'), ('JUBE'), ('JUDO'), ('JUGS'), ('JUJU'),
('JUKE'), ('JUMP'), ('JUNK'), ('JURA'), ('JURY'), ('JUST'), ('JUTE'), ('JUTS'), ('KADI'), ('KAED'), ('KAGU'), ('KAIF'),
('KAIL'), ('KAIN'), ('KAKA'), ('KAKI'), ('KALE'), ('KALI'), ('KAME'), ('KAMI'), ('KANA'), ('KAON'), ('KAPH'), ('KART'),
('KAVA'), ('KAYO'), ('KCAL'), ('KEAS'), ('KECK'), ('KEEF'), ('KEEK'), ('KEEL'), ('KEEN'), ('KEEP'), ('KEGS'), ('KELP'),
('KELT'), ('KENO'), ('KENS'), ('KENT'), ('KEPI'), ('KEPT'), ('KERB'), ('KERF'), ('KERN'), ('KERO'), ('KEYS'), ('KHAN'),
('KHAT'), ('KIBE'), ('KICK'), ('KIDS'), ('KIEF'), ('KIER'), ('KIKE'), ('KILL'), ('KILN'), ('KILO'), ('KILT'), ('KINA'),
('KIND'), ('KINE'), ('KING'), ('KINK'), ('KINO'), ('KIPS'), ('KISH'), ('KISS'), ('KIST'), ('KITE'), ('KITH'), ('KITS'),
('KIVA'), ('KIWI'), ('KNAP'), ('KNAR'), ('KNEE'), ('KNEW'), ('KNIT'), ('KNOB'), ('KNOP'), ('KNOT'), ('KNOW'), ('KNUR'),
('KOAN'), ('KOBO'), ('KOBS'), ('KOEL'), ('KOHL'), ('KOLA'), ('KOLO'), ('KOOK'), ('KOPH'), ('KORS'), ('KOTO'), ('KRIS'),
('KUDO'), ('KUDU'), ('KUNA'), ('KYAT'), ('KYLE'), ('LABS'), ('LACE'), ('LACK'), ('LACY'), ('LADE'), ('LADS'), ('LADY'),
('LAGS'), ('LAIC'), ('LAID'), ('LAIN'), ('LAIR'), ('LAKE'), ('LAKH'), ('LAKY'), ('LAMA'), ('LAMB'), ('LAME'), ('LAMP'),
('LAMS'), ('LAND'), ('LANE'), ('LANK'), ('LAPS'), ('LARD'), ('LARI'), ('LARK'), ('LASE'), ('LASH'), ('LASS'), ('LAST'),
('LATE'), ('LATH'), ('LATI'), ('LATS'), ('LAUD'), ('LAVA'), ('LAVE'), ('LAVS'), ('LAWN'), ('LAWS'), ('LAYS'), ('LAZE'),
('LAZY'), ('LEAD'), ('LEAF'), ('LEAK'), ('LEAL'), ('LEAN'), ('LEAP'), ('LEAS'), ('LECH'), ('LEEK'), ('LEER'), ('LEES'),
('LEET'), ('LEFT'), ('LEGS'), ('LEHR'), ('LEIS'), ('LEKS'), ('LEND'), ('LENO'), ('LENS'), ('LENT'), ('LESS'), ('LEST'),
('LETS'), ('LEVA'), ('LEVY'), ('LEWD'), ('LEYS'), ('LIAR'), ('LICE'), ('LICK'), ('LIDO'), ('LIDS'), ('LIED'), ('LIEF'),
('LIEN'), ('LIES'), ('LIEU'), ('LIFE'), ('LIFT'), ('LIKE'), ('LILO'), ('LILT'), ('LILY'), ('LIMB'), ('LIME'), ('LIMN'),
('LIMO'), ('LIMP'), ('LIMY'), ('LINE'), ('LINK'), ('LINN'), ('LINO'), ('LINT'), ('LINY'), ('LION'), ('LIPS'), ('LIRA'),
('LIRE'), ('LISP'), ('LIST'), ('LITE'), ('LIVE'), ('LOAD'), ('LOAF'), ('LOAM'), ('LOAN'), ('LOBE'), ('LOBO'), ('LOBS'),
('LOCI'), ('LOCK'), ('LOCO'), ('LODE'), ('LOFT'), ('LOGE'), ('LOGO'), ('LOGS'), ('LOGY'), ('LOIN'), ('LOLL'), ('LONE'),
('LONG'), ('LOOK'), ('LOOM'), ('LOON'), ('LOOP'), ('LOOS'), ('LOOT'), ('LOPE'), ('LOPS'), ('LORD'), ('LORE'), ('LORN'),
('LORY'), ('LOSE'), ('LOSS'), ('LOST'), ('LOTA'), ('LOTI'), ('LOTS'), ('LOUD'), ('LOUP'), ('LOUR'), ('LOUT'), ('LOVE'),
('LOWS'), ('LUAU'), ('LUBE'), ('LUCE'), ('LUCK'), ('LUDO'), ('LUES'), ('LUFF'), ('LUGE'), ('LUGS'), ('LULL'), ('LULU'),
('LUMP'), ('LUNE'), ('LUNG'), ('LUNK'), ('LURE'), ('LURK'), ('LUSH'), ('LUST'), ('LUTE'), ('LUXE'), ('LWEI'), ('LYNX'),
('LYRE'), ('LYSE'), ('MACE'), ('MACS'), ('MADE'), ('MADS'), ('MAGE'), ('MAGI'), ('MAGS'), ('MAID'), ('MAIL'), ('MAIM'),
('MAIN'), ('MAKE'), ('MAKO'), ('MALE'), ('MALL'), ('MALM'), ('MALT'), ('MAMA'), ('MAMS'), ('MANA'), ('MANE'), ('MANS'),
('MANY'), ('MAPS'), ('MARA'), ('MARC'), ('MARE'), ('MARK'), ('MARL'), ('MARS'), ('MART'), ('MASH'), ('MASK'), ('MASS'),
('MAST'), ('MATE'), ('MATH'), ('MATS'), ('MATT'), ('MAUL'), ('MAUN'), ('MAWS'), ('MAXI'), ('MAYA'), ('MAYO'), ('MAZE'),
('MAZY'), ('MEAD'), ('MEAL'), ('MEAN'), ('MEAT'), ('MEED'), ('MEEK'), ('MEET'), ('MEGA'), ('MEGS'), ('MELD'), ('MELT'),
('MEME'), ('MEMO'), ('MEMS'), ('MEND'), ('MENE'), ('MENU'), ('MEOW'), ('MERE'), ('MESA'), ('MESH'), ('MESS'), ('METE'),
('METH'), ('MEWL'), ('MEWS'), ('MHOS'), ('MICA'), ('MICE'), ('MICK'), ('MICS'), ('MIDI'), ('MIEN'), ('MIFF'), ('MIKE'),
('MILD'), ('MILE'), ('MILF'), ('MILK'), ('MILL'), ('MILO'), ('MILS'), ('MILT'), ('MIME'), ('MIND'), ('MINE'), ('MINI'),
('MINK'), ('MINT'), ('MINX'), ('MIRE'), ('MIRK'), ('MIRY'), ('MISE'), ('MISO'), ('MISS'), ('MIST'), ('MITE'), ('MITT'),
('MIZE'), ('MKAY'), ('MOAN'), ('MOAS'), ('MOAT'), ('MOBS'), ('MOCK'), ('MODE'), ('MODS'), ('MOIL'), ('MOJO'), ('MOKE'),
('MOLA'), ('MOLD'), ('MOLE'), ('MOLL'), ('MOLS'), ('MOLT'), ('MOLY'), ('MOMS'), ('MONG'), ('MONK'), ('MONO'), ('MOOD'),
('MOON'), ('MOOR'), ('MOOS'), ('MOOT'), ('MOPE'), ('MOPS'), ('MORA'), ('MORE'), ('MORN'), ('MORT'), ('MOSH'), ('MOSS'),
('MOST'), ('MOTE'), ('MOTH'), ('MOTS'), ('MOUE'), ('MOVE'), ('MOWS'), ('MOXA'), ('MUCH'), ('MUCK'), ('MUFF'), ('MUGS'),
('MULE'), ('MULL'), ('MUMP'), ('MUMS'), ('MUON'), ('MURE'), ('MURK'), ('MUSE'), ('MUSH'), ('MUSK'), ('MUSS'), ('MUST'),
('MUTE'), ('MUTS'), ('MUTT'), ('MUZZ'), ('MYNA'), ('MYTH'), ('NAAN'), ('NABS'), ('NAFF'), ('NAGS'), ('NAIF'), ('NAIL'),
('NAME'), ('NAOS'), ('NAPE'), ('NAPS'), ('NARC'), ('NARD'), ('NARK'), ('NARY'), ('NAVE'), ('NAVY'), ('NAYS'), ('NEAP'),
('NEAR'), ('NEAT'), ('NEBS'), ('NECK'), ('NEED'), ('NEON'), ('NERD'), ('NESS'), ('NEST'), ('NETS'), ('NEVI'), ('NEWS'),
('NEWT'), ('NEXT'), ('NIBS'), ('NICE'), ('NICK'), ('NIDE'), ('NIFF'), ('NIGH'), ('NINE'), ('NIPA'), ('NIPS'), ('NISI'),
('NITS'), ('NOBS'), ('NOCK'), ('NODE'), ('NODI'), ('NODS'), ('NOEL'), ('NOES'), ('NOGS'), ('NOIL'), ('NOLO'), ('NOMA'),
('NONE'), ('NOOK'), ('NOON'), ('NOPE'), ('NORM'), ('NOSE'), ('NOSH'), ('NOSY'), ('NOTE'), ('NOUN'), ('NOUS'), ('NOVA'),
('NOWT'), ('NUBS'), ('NUDE'), ('NUKE'), ('NULL'), ('NUMB'), ('NUNS'), ('NUTS'), ('OAFS'), ('OAKS'), ('OARS'), ('OAST'),
('OATH'), ('OATS'), ('OBEY'), ('OBIS'), ('OBIT'), ('OBOE'), ('ODDS'), ('ODEA'), ('ODES'), ('ODOR'), ('ODYL'), ('OFAY'),
('OFFS'), ('OGEE'), ('OGLE'), ('OGRE'), ('OHMS'), ('OIKS'), ('OILS'), ('OILY'), ('OINK'), ('OKAS'), ('OKAY'), ('OKRA'),
('OLEO'), ('OLES'), ('OLID'), ('OLIO'), ('OLLA'), ('OMEN'), ('OMER'), ('OMIT'), ('ONCE'), ('ONES'), ('ONLY'), ('ONTO'),
('ONUS'), ('ONYX'), ('OOHS'), ('OOPS'), ('OOZE'), ('OOZY'), ('OPAH'), ('OPAL'), ('OPED'), ('OPEN'), ('OPES'), ('OPTS'),
('OPUS'), ('ORAL'), ('ORBS'), ('ORCA'), ('ORCS'), ('ORDO'), ('ORES'), ('ORGY'), ('ORLE'), ('ORTS'), ('ORYX'), ('ORZO'),
('OSES'), ('OTIC'), ('OTTO'), ('OUCH'), ('OURS'), ('OUST'), ('OUTS'), ('OUZO'), ('OVAL'), ('OVEN'), ('OVER'), ('OVUM'),
('OWED'), ('OWES'), ('OWLS'), ('OWNS'), ('OXEN'), ('OYER'), ('OYEZ'), ('PACE'), ('PACK'), ('PACT'), ('PACY'), ('PADS'),
('PAGE'), ('PAID'), ('PAIL'), ('PAIN'), ('PAIR'), ('PALE'), ('PALL'), ('PALM'), ('PALP'), ('PALS'), ('PALY'), ('PANE'),
('PANG'), ('PANS'), ('PANT'), ('PAPA'), ('PAPS'), ('PARD'), ('PARE'), ('PARK'), ('PARR'), ('PARS'), ('PART'), ('PASE'),
('PASH'), ('PASS'), ('PAST'), ('PATE'), ('PATH'), ('PATS'), ('PAVE'), ('PAWL'), ('PAWN'), ('PAWS'), ('PAYS'), ('PEAG'),
('PEAK'), ('PEAL'), ('PEAN'), ('PEAR'), ('PEAS'), ('PEAT'), ('PEBA'), ('PECK'), ('PECS'), ('PEED'), ('PEEK'), ('PEEL'),
('PEEN'), ('PEEP'), ('PEER'), ('PEES'), ('PEGS'), ('PEKE'), ('PELF'), ('PELT'), ('PENG'), ('PENS'), ('PENT'), ('PEON'),
('PEPS'), ('PERI'), ('PERK'), ('PERM'), ('PERT'), ('PERV'), ('PESO'), ('PEST'), ('PETS'), ('PEWS'), ('PHAT'), ('PHEW'),
('PHIS'), ('PHIZ'), ('PICA'), ('PICE'), ('PICK'), ('PICS'), ('PIED'), ('PIER'), ('PIES'), ('PIET'), ('PIGS'), ('PIKA'),
('PIKE'), ('PILE'), ('PILI'), ('PILL'), ('PILY'), ('PIMP'), ('PINE'), ('PING'), ('PINK'), ('PINS'), ('PINT'), ('PION'),
('PIPE'), ('PIPS'), ('PIRN'), ('PISH'), ('PISO'), ('PISS'), ('PITA'), ('PITH'), ('PITS'), ('PITY'), ('PLAN'), ('PLAY'),
('PLEA'), ('PLEB'), ('PLOD'), ('PLOP'), ('PLOT'), ('PLOW'), ('PLOY'), ('PLUG'), ('PLUM'), ('PLUS'), ('POCK'), ('POCO'),
('PODS'), ('POEM'), ('POET'), ('POGO'), ('POGY'), ('POKE'), ('POKY'), ('POLE'), ('POLL'), ('POLO'), ('POLS'), ('POLY'),
('POME'), ('POMP'), ('POMS'), ('POND'), ('PONE'), ('PONG'), ('PONS'), ('PONY'), ('POOD'), ('POOF'), ('POOH'), ('POOL'),
('POON'), ('POOP'), ('POOR'), ('POOS'), ('POPE'), ('POPS'), ('PORE'), ('PORK'), ('PORN'), ('PORT'), ('POSE'), ('POSH'),
('POST'), ('POSY'), ('POTS'), ('POUF'), ('POUR'), ('POUT'), ('PRAM'), ('PRAT'), ('PRAU'), ('PRAY'), ('PREP'), ('PREY'),
('PRIG'), ('PRIM'), ('PROA'), ('PROD'), ('PROF'), ('PROM'), ('PROP'), ('PROS'), ('PROW'), ('PSIA'), ('PSID'), ('PSIS'),
('PSST'), ('PUBS'), ('PUCA'), ('PUCE'), ('PUCK'), ('PUDS'), ('PUFF'), ('PUGS'), ('PUKE'), ('PULA'), ('PULE'), ('PULI'),
('PULL'), ('PULP'), ('PULS'), ('PUMA'), ('PUMP'), ('PUNG'), ('PUNK'), ('PUNS'), ('PUNT'), ('PUNY'), ('PUPA'), ('PUPS'),
('PURE'), ('PURL'), ('PURR'), ('PUSH'), ('PUSS'), ('PUTS'), ('PUTT'), ('PUTZ'), ('PWNS'), ('PYAS'), ('PYRE'), ('QADI'),
('QOPH'), ('QUAD'), ('QUAG'), ('QUAI'), ('QUAY'), ('QUID'), ('QUIN'), ('QUIP'), ('QUIT'), ('QUIZ'), ('QUOD'), ('RACE'),
('RACK'), ('RACY'), ('RADS'), ('RAFF'), ('RAFT'), ('RAGA'), ('RAGE'), ('RAGI'), ('RAGS'), ('RAID'), ('RAIL'), ('RAIN'),
('RAKE'), ('RAKI'), ('RALE'), ('RAMP'), ('RAMS'), ('RAND'), ('RANG'), ('RANK'), ('RANT'), ('RAPE'), ('RAPS'), ('RAPT'),
('RARE'), ('RASH'), ('RASP'), ('RATA'), ('RATE'), ('RATH'), ('RATS'), ('RAVE'), ('RAYS'), ('RAZE'), ('RAZZ'), ('READ'),
('REAL'), ('REAM'), ('REAP'), ('REAR'), ('RECK'), ('REDD'), ('REDE'), ('REDO'), ('REDS'), ('REED'), ('REEF'), ('REEK'),
('REEL'), ('REFS'), ('REFT'), ('REIN'), ('RELY'), ('REMS'), ('REND'), ('RENT'), ('REPP'), ('REPS'), ('RESH'), ('REST'),
('RETE'), ('RETS'), ('REVS'), ('RHEA'), ('RHOS'), ('RIAL'), ('RIBS'), ('RICE'), ('RICH'), ('RICK'), ('RIDE'), ('RIDS'),
('RIEL'), ('RIFE'), ('RIFF'), ('RIFT'), ('RIGS'), ('RILE'), ('RILL'), ('RIME'), ('RIMS'), ('RIMY'), ('RIND'), ('RING'),
('RINK'), ('RIOT'), ('RIPE'), ('RIPS'), ('RISE'), ('RISK'), ('RITE'), ('RIVE'), ('ROAD'), ('ROAM'), ('ROAN'), ('ROAR'),
('ROBE'), ('ROBS'), ('ROCK'), ('ROCS'), ('RODE'), ('RODS'), ('ROES'), ('ROIL'), ('ROLE'), ('ROLL'), ('ROMP'), ('ROOD'),
('ROOF'), ('ROOK'), ('ROOM'), ('ROOT'), ('ROPE'), ('ROPY'), ('ROSE'), ('ROSY'), ('ROTA'), ('ROTE'), ('ROTL'), ('ROTS'),
('ROUP'), ('ROUT'), ('ROUX'), ('ROVE'), ('ROWS'), ('RUBE'), ('RUBS'), ('RUBY'), ('RUCK'), ('RUDD'), ('RUDE'), ('RUED'),
('RUES'), ('RUFF'), ('RUGS'), ('RUIN'), ('RULE'), ('RUMP'), ('RUMS'), ('RUNE'), ('RUNG'), ('RUNS'), ('RUNT'), ('RUSE'),
('RUSH'), ('RUSK'), ('RUST'), ('RUTH'), ('RUTS'), ('RYAS'), ('SACK'), ('SACS'), ('SAFE'), ('SAGA'), ('SAGE'), ('SAGO'),
('SAGS'), ('SAID'), ('SAIL'), ('SAIN'), ('SAKE'), ('SAKI'), ('SALE'), ('SALT'), ('SAME'), ('SAND'), ('SANE'), ('SANG'),
('SANK'), ('SANS'), ('SAPS'), ('SARD'), ('SARI'), ('SASH'), ('SASS'), ('SATE'), ('SATI'), ('SAVE'), ('SAWS'), ('SAYS'),
('SCAB'), ('SCAD'), ('SCAM'), ('SCAN'), ('SCAR'), ('SCAT'), ('SCOP'), ('SCOW'), ('SCUD'), ('SCUM'), ('SCUP'), ('SCUT'),
('SEAL'), ('SEAM'), ('SEAR'), ('SEAS'), ('SEAT'), ('SECH'), ('SECS'), ('SECT'), ('SEED'), ('SEEK'), ('SEEL'), ('SEEM'),
('SEEN'), ('SEEP'), ('SEER'), ('SEES'), ('SELF'), ('SELL'), ('SEMI'), ('SEND'), ('SENE'), ('SENS'), ('SENT'), ('SEPT'),
('SERE'), ('SERF'), ('SETA'), ('SETS'), ('SETT'), ('SEWN'), ('SEWS'), ('SEXT'), ('SEXY'), ('SHAD'), ('SHAG'), ('SHAH'),
('SHAM'), ('SHAW'), ('SHAY'), ('SHED'), ('SHER'), ('SHES'), ('SHEW'), ('SHIM'), ('SHIN'), ('SHIP'), ('SHIT'), ('SHIV'),
('SHMO'), ('SHOD'), ('SHOE'), ('SHOO'), ('SHOP'), ('SHOT'), ('SHOW'), ('SHUL'), ('SHUN'), ('SHUT'), ('SIBS'), ('SICK'),
('SICS'), ('SIDE'), ('SIFT'), ('SIGH'), ('SIGN'), ('SIKA'), ('SIKE'), ('SILD'), ('SILK'), ('SILL'), ('SILO'), ('SILT'),
('SIMA'), ('SIMP'), ('SIMS'), ('SINE'), ('SING'), ('SINH'), ('SINK'), ('SINS'), ('SIPS'), ('SIRE'), ('SIRS'), ('SITE'),
('SITS'), ('SIZE'), ('SKAT'), ('SKEG'), ('SKEP'), ('SKEW'), ('SKID'), ('SKIM'), ('SKIN'), ('SKIP'), ('SKIS'), ('SKIT'),
('SKOL'), ('SKUA'), ('SLAB'), ('SLAG'), ('SLAM'), ('SLAP'), ('SLAT'), ('SLAW'), ('SLAY'), ('SLED'), ('SLEW'), ('SLID'),
('SLIM'), ('SLIP'), ('SLIT'), ('SLOB'), ('SLOE'), ('SLOG'), ('SLOP'), ('SLOT'), ('SLOW'), ('SLUB'), ('SLUE'), ('SLUG'),
('SLUM'), ('SLUR'), ('SLUT'), ('SMEW'), ('SMOG'), ('SMUG'), ('SMUT'), ('SNAG'), ('SNAP'), ('SNIP'), ('SNIT'), ('SNOB'),
('SNOG'), ('SNOT'), ('SNOW'), ('SNUB'), ('SNUG'), ('SOAK'), ('SOAP'), ('SOAR'), ('SOBA'), ('SOBS'), ('SOCK'), ('SODA'),
('SODS'), ('SOFA'), ('SOFT'), ('SOIL'), ('SOKE'), ('SOLA'), ('SOLD'), ('SOLE'), ('SOLO'), ('SOLS'), ('SOMA'), ('SOME'),
('SONE'), ('SONG'), ('SONS'), ('SOON'), ('SOOT'), ('SOPS'), ('SORA'), ('SORB'), ('SORE'), ('SORI'), ('SORN'), ('SORT'),
('SOTS'), ('SOUK'), ('SOUL'), ('SOUP'), ('SOUR'), ('SOUS'), ('SOWN'), ('SOWS'), ('SPAE'), ('SPAM'), ('SPAN'), ('SPAR'),
('SPAS'), ('SPAT'), ('SPAY'), ('SPEC'), ('SPED'), ('SPEW'), ('SPIC'), ('SPIN'), ('SPIT'), ('SPIV'), ('SPOT'), ('SPRY'),
('SPUD'), ('SPUE'), ('SPUN'), ('SPUR'), ('STAB'), ('STAG'), ('STAR'), ('STAY'), ('STEM'), ('STEP'), ('STET'), ('STEW'),
('STIR'), ('STOA'), ('STOB'), ('STOP'), ('STOR'), ('STOW'), ('STUB'), ('STUD'), ('STUN'), ('SUBS'), ('SUCH'), ('SUCK'),
('SUDD'), ('SUDS'), ('SUED'), ('SUER'), ('SUES'), ('SUET'), ('SUIT'), ('SULK'), ('SUMO'), ('SUMP'), ('SUMS'), ('SUNG'),
('SUNK'), ('SUNN'), ('SUNS'), ('SUPS'), ('SURA'), ('SURD'), ('SURE'), ('SURF'), ('SUSS'), ('SWAB'), ('SWAG'), ('SWAM'),
('SWAN'), ('SWAP'), ('SWAT'), ('SWAY'), ('SWIG'), ('SWIM'), ('SWIZ'), ('SWOT'), ('SWUM'), ('SYCE'), ('SYNC'), ('SYNE'),
('TABS'), ('TACE'), ('TACH'), ('TACK'), ('TACO'), ('TACT'), ('TADS'), ('TAEL'), ('TAGS'), ('TAHR'), ('TAIL'), ('TAIN'),
('TAKA'), ('TAKE'), ('TALA'), ('TALC'), ('TALE'), ('TALI'), ('TALK'), ('TALL'), ('TAME'), ('TAMP'), ('TAMS'), ('TANA'),
('TANG'), ('TANH'), ('TANK'), ('TANS'), ('TAPE'), ('TAPS'), ('TARE'), ('TARN'), ('TARO'), ('TARP'), ('TARS'), ('TART'),
('TASK'), ('TASS'), ('TATS'), ('TAUS'), ('TAUT'), ('TAWS'), ('TAXA'), ('TAXI'), ('TEAK'), ('TEAL'), ('TEAM'), ('TEAR'),
('TEAS'), ('TEAT'), ('TEDS'), ('TEED'), ('TEEM'), ('TEEN'), ('TEES'), ('TELL'), ('TELS'), ('TEMP'), ('TEND'), ('TENS'),
('TENT'), ('TERF'), ('TERM'), ('TERN'), ('TEST'), ('TETH'), ('TEXT'), ('THAN'), ('THAR'), ('THAT'), ('THAW'), ('THEE'),
('THEM'), ('THEN'), ('THEW'), ('THEY'), ('THIN'), ('THIS'), ('THOU'), ('THRU'), ('THUD'), ('THUG'), ('THUS'), ('TICK'),
('TICS'), ('TIDE'), ('TIDY'), ('TIED'), ('TIER'), ('TIES'), ('TIFF'), ('TIKI'), ('TILE'), ('TILL'), ('TILT'), ('TIME'),
('TINE'), ('TING'), ('TINS'), ('TINT'), ('TINY'), ('TIPS'), ('TIRE'), ('TITI'), ('TITS'), ('TIZZ'), ('TOAD'), ('TODY'),
('TOEA'), ('TOED'), ('TOES'), ('TOFF'), ('TOFT'), ('TOFU'), ('TOGA'), ('TOGS'), ('TOIL'), ('TOKE'), ('TOLA'), ('TOLD'),
('TOLE'), ('TOLL'), ('TOLU'), ('TOMB'), ('TOME'), ('TOMS'), ('TONE'), ('TONG'), ('TONS'), ('TONY'), ('TOOK'), ('TOOL'),
('TOOT'), ('TOPE'), ('TOPI'), ('TOPS'), ('TORE'), ('TORI'), ('TORN'), ('TORR'), ('TORS'), ('TORT'), ('TOSH'), ('TOSS'),
('TOTE'), ('TOTS'), ('TOUR'), ('TOUT'), ('TOWN'), ('TOWS'), ('TOYS'), ('TRAD'), ('TRAM'), ('TRAP'), ('TRAY'), ('TREE'),
('TREF'), ('TREK'), ('TRET'), ('TREY'), ('TRIG'), ('TRIM'), ('TRIO'), ('TRIP'), ('TROD'), ('TROT'), ('TROW'), ('TROY'),
('TRUE'), ('TRUG'), ('TSAR'), ('TUBA'), ('TUBE'), ('TUBS'), ('TUCK'), ('TUFA'), ('TUFF'), ('TUFT'), ('TUGS'), ('TUMS'),
('TUNA'), ('TUNE'), ('TUNS'), ('TURD'), ('TURF'), ('TURN'), ('TUSH'), ('TUSK'), ('TUTS'), ('TUTU'), ('TWAS'), ('TWAT'),
('TWEE'), ('TWIG'), ('TWIN'), ('TWIT'), ('TWOS'), ('TYKE'), ('TYPE'), ('TYPO'), ('TYRE'), ('TYRO'), ('UGLY'), ('ULNA'),
('UMPS'), ('UNDO'), ('UNIS'), ('UNIT'), ('UNTO'), ('UPAS'), ('UPDO'), ('UPON'), ('UREA'), ('URGE'), ('URIC'), ('URNS'),
('URUS'), ('USED'), ('USER'), ('USES'), ('UVEA'), ('VACS'), ('VAGI'), ('VAIL'), ('VAIN'), ('VAIR'), ('VALE'), ('VAMP'),
('VANE'), ('VANG'), ('VANS'), ('VAPE'), ('VARA'), ('VARS'), ('VARY'), ('VASA'), ('VASE'), ('VAST'), ('VATS'), ('VATU'),
('VEAL'), ('VEEP'), ('VEER'), ('VEIL'), ('VEIN'), ('VELA'), ('VELD'), ('VENA'), ('VEND'), ('VENT'), ('VERB'), ('VERY'),
('VEST'), ('VETO'), ('VETS'), ('VIAL'), ('VIBE'), ('VICE'), ('VIDE'), ('VIED'), ('VIER'), ('VIES'), ('VIEW'), ('VILE'),
('VINA'), ('VINE'), ('VINO'), ('VIOL'), ('VIRE'), ('VISA'), ('VISE'), ('VITA'), ('VIVA'), ('VIVE'), ('VOES'), ('VOID'),
('VOLE'), ('VOLT'), ('VOTE'), ('VOWS'), ('WACK'), ('WADE'), ('WADI'), ('WADS'), ('WAFT'), ('WAGE'), ('WAGS'), ('WAIF'),
('WAIL'), ('WAIN'), ('WAIT'), ('WAKE'), ('WALE'), ('WALK'), ('WALL'), ('WAME'), ('WAND'), ('WANE'), ('WANK'), ('WANT'),
('WARD'), ('WARE'), ('WARM'), ('WARN'), ('WARP'), ('WARS'), ('WART'), ('WARY'), ('WASH'), ('WASP'), ('WAST'), ('WATT'),
('WAVE'), ('WAVY'), ('WAWS'), ('WAXY'), ('WAYS'), ('WEAK'), ('WEAL'), ('WEAN'), ('WEAR'), ('WEBS'), ('WEDS'), ('WEED'),
('WEEK'), ('WEEN'), ('WEEP'), ('WEER'), ('WEES'), ('WEFT'), ('WEIR'), ('WEKA'), ('WELD'), ('WELL'), ('WELT'), ('WEND'),
('WENS'), ('WENT'), ('WEPT'), ('WERE'), ('WERT'), ('WEST'), ('WETS'), ('WHAM'), ('WHAP'), ('WHAT'), ('WHEE'), ('WHEN'),
('WHET'), ('WHEW'), ('WHEY'), ('WHIM'), ('WHIN'), ('WHIP'), ('WHIR'), ('WHIT'), ('WHIZ'), ('WHOA'), ('WHOM'), ('WHOP'),
('WHUP'), ('WHYS'), ('WICK'), ('WIDE'), ('WIFE'), ('WIGS'), ('WIKI'), ('WILD'), ('WILE'), ('WILL'), ('WILT'), ('WILY'),
('WIMP'), ('WIND'), ('WINE'), ('WING'), ('WINK'), ('WINO'), ('WINS'), ('WINY'), ('WIPE'), ('WIRE'), ('WIRY'), ('WISE'),
('WISH'), ('WISP'), ('WIST'), ('WITE'), ('WITH'), ('WITS'), ('WIVE'), ('WOAD'), ('WOES'), ('WOGS'), ('WOKE'), ('WOKS'),
('WOLD'), ('WOLF'), ('WOMB'), ('WONK'), ('WONT'), ('WOOD'), ('WOOF'), ('WOOL'), ('WOOS'), ('WOPS'), ('WORD'), ('WORE'),
('WORK'), ('WORM'), ('WORN'), ('WORT'), ('WOVE'), ('WOWS'), ('WRAP'), ('WREN'), ('WRIT'), ('WUSS'), ('WYND'), ('YAKS'),
('YAMS'), ('YANG'), ('YANK'), ('YAPS'), ('YARD'), ('YARE'), ('YARN'), ('YAWL'), ('YAWN'), ('YAWP'), ('YAWS'), ('YEAH'),
('YEAN'), ('YEAR'), ('YEAS'), ('YEGG'), ('YELD'), ('YELL'), ('YELP'), ('YENS'), ('YEPS'), ('YEST'), ('YETI'), ('YEWS'),
('YIDS'), ('YIPE'), ('YIPS'), ('YLEM'), ('YOBS'), ('YOGA'), ('YOGH'), ('YOGI'), ('YOKE'), ('YOLK'), ('YONI'), ('YORE'),
('YORK'), ('YOUR'), ('YOUS'), ('YOWL'), ('YUAN'), ('YUCK'), ('YUKS'), ('YULE'), ('YUPS'), ('YURT'), ('YWIS'), ('ZANY'),
('ZAPS'), ('ZARF'), ('ZEAL'), ('ZEBU'), ('ZEDS'), ('ZEES'), ('ZERO'), ('ZEST'), ('ZETA'), ('ZIGS'), ('ZINC'), ('ZINE'),
('ZING'), ('ZIPS'), ('ZITI'), ('ZITS'), ('ZONE'), ('ZONK'), ('ZOOM'), ('ZOON'), ('ZOOS');

truncate public.start_words;
insert into public.start_words (idx, word, optimal) values
(0, 'ADDS', 6), (1, 'AGES', 6), (2, 'AIMS', 5), (3, 'ARMS', 6), (4, 'ARTS', 6), (5, 'AUNT', 5),
(6, 'AXES', 6), (7, 'BABY', 5), (8, 'BACK', 5), (9, 'BAGS', 4), (10, 'BAKE', 4), (11, 'BALL', 5),
(12, 'BAND', 5), (13, 'BANG', 5), (14, 'BANK', 5), (15, 'BANS', 4), (16, 'BARE', 4), (17, 'BARK', 5),
(18, 'BARS', 4), (19, 'BASE', 3), (20, 'BASH', 3), (21, 'BASS', 3), (22, 'BATH', 4), (23, 'BEAM', 6),
(24, 'BEAN', 6), (25, 'BEAR', 5), (26, 'BEAT', 5), (27, 'BEDS', 4), (28, 'BEEF', 6), (29, 'BEEN', 6),
(30, 'BELL', 5), (31, 'BELT', 5), (32, 'BEND', 5), (33, 'BENT', 5), (34, 'BEST', 4), (35, 'BETA', 5),
(36, 'BETS', 4), (37, 'BIAS', 4), (38, 'BIDS', 4), (39, 'BILL', 5), (40, 'BIND', 5), (41, 'BIRD', 6),
(42, 'BITE', 4), (43, 'BITS', 4), (44, 'BLOB', 5), (45, 'BLOW', 6), (46, 'BOAT', 4), (47, 'BODY', 4),
(48, 'BOGS', 3), (49, 'BOIL', 5), (50, 'BOLD', 4), (51, 'BOLT', 4), (52, 'BOND', 4), (53, 'BONE', 3),
(54, 'BOOK', 4), (55, 'BOOM', 4), (56, 'BOOT', 4), (57, 'BORE', 3), (58, 'BORN', 4), (59, 'BOTH', 3),
(60, 'BOUT', 4), (61, 'BOWL', 4), (62, 'BOYS', 3), (63, 'BRED', 6), (64, 'BUCK', 5), (65, 'BUGS', 4),
(66, 'BULB', 6), (67, 'BULK', 5), (68, 'BULL', 5), (69, 'BUMP', 5), (70, 'BURN', 5), (71, 'BURY', 5),
(72, 'BUSH', 3), (73, 'BUSY', 4), (74, 'BUYS', 4), (75, 'BYTE', 5), (76, 'CAGE', 4), (77, 'CAKE', 3),
(78, 'CALL', 5), (79, 'CALM', 5), (80, 'CAME', 4), (81, 'CAMP', 5), (82, 'CANS', 4), (83, 'CAPS', 4),
(84, 'CARD', 5), (85, 'CARE', 4), (86, 'CARS', 5), (87, 'CASE', 3), (88, 'CASH', 3), (89, 'CAST', 4),
(90, 'CATS', 4), (91, 'CAVE', 4), (92, 'CELL', 5), (93, 'CENT', 5), (94, 'CHAP', 6), (95, 'CHAR', 6),
(96, 'CHAT', 5), (97, 'CHIP', 6), (98, 'CHOP', 5), (99, 'CITE', 4), (100, 'CITY', 5), (101, 'CLIP', 6),
(102, 'CLOG', 5), (103, 'COAL', 5), (104, 'COAT', 4), (105, 'CODE', 3), (106, 'COIN', 5), (107, 'COLD', 4),
(108, 'COME', 3), (109, 'COOK', 4), (110, 'COOL', 4), (111, 'COPE', 3), (112, 'COPY', 4), (113, 'CORE', 3),
(114, 'CORN', 4), (115, 'COST', 3), (116, 'COSY', 3), (117, 'COWS', 3), (118, 'COZY', 4), (119, 'CROP', 5),
(120, 'CUBE', 4), (121, 'CUPS', 4), (122, 'CURE', 4), (123, 'CUTE', 4), (124, 'CUTS', 4), (125, 'DAFT', 5),
(126, 'DAMP', 4), (127, 'DARE', 4), (128, 'DARK', 5), (129, 'DASH', 3), (130, 'DATA', 4), (131, 'DATE', 3),
(132, 'DAWN', 5), (133, 'DAYS', 4), (134, 'DEAF', 6), (135, 'DEAL', 5), (136, 'DEAR', 6), (137, 'DEBT', 5),
(138, 'DECK', 5), (139, 'DEED', 6), (140, 'DEEM', 6), (141, 'DEEP', 6), (142, 'DEFY', 5), (143, 'DENY', 4),
(144, 'DESK', 5), (145, 'DIAL', 5), (146, 'DICE', 4), (147, 'DIET', 5), (148, 'DIGS', 4), (149, 'DINE', 3),
(150, 'DIRE', 4), (151, 'DIRT', 5), (152, 'DISC', 4), (153, 'DISH', 3), (154, 'DISK', 4), (155, 'DIVE', 3),
(156, 'DOES', 3), (157, 'DOGS', 3), (158, 'DOOM', 5), (159, 'DOOR', 5), (160, 'DOTS', 3), (161, 'DOWN', 5),
(162, 'DRAG', 6), (163, 'DRAW', 6), (164, 'DROP', 6), (165, 'DUAL', 5), (166, 'DUCK', 5), (167, 'DULL', 4),
(168, 'DULY', 5), (169, 'DUMB', 6), (170, 'DUMP', 5), (171, 'DUST', 3), (172, 'DUTY', 6), (173, 'EACH', 5),
(174, 'EARN', 6), (175, 'EARS', 5), (176, 'EASE', 3), (177, 'EAST', 4), (178, 'EASY', 4), (179, 'EATS', 5),
(180, 'ELSE', 4), (181, 'EYES', 5), (182, 'FACE', 4), (183, 'FACT', 5), (184, 'FAIL', 6), (185, 'FAIR', 6),
(186, 'FAKE', 4), (187, 'FALL', 5), (188, 'FAME', 4), (189, 'FANS', 5), (190, 'FARE', 4), (191, 'FARM', 5),
(192, 'FAST', 4), (193, 'FATE', 4), (194, 'FEAR', 6), (195, 'FEAT', 5), (196, 'FEED', 5), (197, 'FEEL', 5),
(198, 'FEES', 4), (199, 'FEET', 5), (200, 'FELL', 5), (201, 'FELT', 5), (202, 'FILE', 4), (203, 'FILL', 5),
(204, 'FILM', 5), (205, 'FIND', 5), (206, 'FINE', 4), (207, 'FIRE', 4), (208, 'FIRM', 5), (209, 'FISH', 4),
(210, 'FITS', 5), (211, 'FIVE', 4), (212, 'FLAT', 6), (213, 'FOAM', 5), (214, 'FOLD', 4), (215, 'FOLK', 5),
(216, 'FOND', 4), (217, 'FONT', 5), (218, 'FOOD', 5), (219, 'FOOL', 5), (220, 'FOOT', 4), (221, 'FORK', 4),
(222, 'FORM', 4), (223, 'FOUL', 6), (224, 'FOUR', 5), (225, 'FUEL', 6), (226, 'FULL', 5), (227, 'FUME', 4),
(228, 'FUND', 5), (229, 'FUSE', 3), (230, 'FUSS', 4), (231, 'GAIN', 6), (232, 'GAME', 4), (233, 'GANG', 5),
(234, 'GAPS', 5), (235, 'GASP', 4), (236, 'GATE', 4), (237, 'GAVE', 4), (238, 'GEAR', 6), (239, 'GENE', 4),
(240, 'GETS', 4), (241, 'GIFT', 5), (242, 'GIRL', 6), (243, 'GIVE', 4), (244, 'GLAD', 6), (245, 'GLUE', 6),
(246, 'GOAL', 6), (247, 'GOAT', 5), (248, 'GOES', 4), (249, 'GOLD', 4), (250, 'GOLF', 5), (251, 'GONE', 3),
(252, 'GOOD', 5), (253, 'GOWN', 5), (254, 'GRAY', 6), (255, 'GREY', 6), (256, 'GULF', 6), (257, 'GUTS', 4),
(258, 'GUYS', 4), (259, 'HACK', 5), (260, 'HAIL', 5), (261, 'HAIR', 6), (262, 'HALF', 4), (263, 'HALL', 4),
(264, 'HALT', 4), (265, 'HAND', 5), (266, 'HANG', 4), (267, 'HARD', 5), (268, 'HARM', 5), (269, 'HASH', 4),
(270, 'HATS', 4), (271, 'HAVE', 3), (272, 'HAZY', 5), (273, 'HEAD', 5), (274, 'HEAP', 5), (275, 'HEAR', 5),
(276, 'HEAT', 4), (277, 'HEEL', 6), (278, 'HELD', 4), (279, 'HELP', 4), (280, 'HERD', 5), (281, 'HERE', 4),
(282, 'HERO', 5), (283, 'HIDE', 4), (284, 'HILL', 5), (285, 'HINT', 5), (286, 'HIRE', 4), (287, 'HITS', 4),
(288, 'HOLD', 3), (289, 'HOLY', 3), (290, 'HOOK', 4), (291, 'HORN', 4), (292, 'HOUR', 5), (293, 'HUGE', 4),
(294, 'HUNG', 4), (295, 'HUNT', 5), (296, 'HURT', 5), (297, 'JACK', 5), (298, 'JAIL', 6), (299, 'JAMS', 4),
(300, 'JAZZ', 6), (301, 'JEST', 3), (302, 'JOIN', 5), (303, 'JUMP', 5), (304, 'JUNK', 5), (305, 'JURY', 6),
(306, 'JUST', 4), (307, 'KEEN', 6), (308, 'KEEP', 6), (309, 'KEPT', 6), (310, 'KEYS', 5), (311, 'KICK', 5),
(312, 'KIDS', 5), (313, 'KIND', 5), (314, 'KING', 5), (315, 'KISS', 4), (316, 'KITS', 5), (317, 'LABS', 4),
(318, 'LACK', 4), (319, 'LADY', 4), (320, 'LAID', 5), (321, 'LAIN', 5), (322, 'LAKE', 3), (323, 'LAMP', 4),
(324, 'LAND', 4), (325, 'LANE', 3), (326, 'LARK', 5), (327, 'LAST', 3), (328, 'LATE', 3), (329, 'LAWN', 5),
(330, 'LAWS', 4), (331, 'LAYS', 4), (332, 'LAZY', 4), (333, 'LEAD', 5), (334, 'LEAF', 5), (335, 'LEAK', 5),
(336, 'LEAN', 5), (337, 'LEAP', 5), (338, 'LEFT', 4), (339, 'LEGS', 4), (340, 'LEND', 5), (341, 'LENS', 4),
(342, 'LENT', 4), (343, 'LESS', 3), (344, 'LEST', 3), (345, 'LETS', 4), (346, 'LIED', 6), (347, 'LIES', 5),
(348, 'LIFE', 4), (349, 'LIFT', 4), (350, 'LIKE', 4), (351, 'LIMB', 5), (352, 'LINE', 3), (353, 'LINK', 4),
(354, 'LION', 5), (355, 'LIPS', 4), (356, 'LIST', 3), (357, 'LIVE', 3), (358, 'LOAD', 4), (359, 'LOAN', 4),
(360, 'LOCK', 5), (361, 'LOGO', 3), (362, 'LOGS', 3), (363, 'LONG', 3), (364, 'LOOK', 4), (365, 'LOOP', 4),
(366, 'LORD', 3), (367, 'LOTS', 3), (368, 'LOUD', 4), (369, 'LUCK', 5), (370, 'LUMP', 5), (371, 'LUNG', 4),
(372, 'LURK', 4), (373, 'MADE', 4), (374, 'MAIL', 6), (375, 'MAIN', 6), (376, 'MAKE', 3), (377, 'MALE', 4),
(378, 'MANY', 5), (379, 'MAPS', 4), (380, 'MARK', 5), (381, 'MASK', 4), (382, 'MASS', 3), (383, 'MATE', 4),
(384, 'MAZE', 4), (385, 'MEAL', 6), (386, 'MEAN', 5), (387, 'MEAT', 5), (388, 'MEET', 5), (389, 'MELT', 5),
(390, 'MEND', 5), (391, 'MENU', 5), (392, 'MERE', 4), (393, 'MESS', 3), (394, 'MICE', 4), (395, 'MILD', 5),
(396, 'MILE', 4), (397, 'MILK', 5), (398, 'MILL', 5), (399, 'MIND', 5), (400, 'MINE', 4), (401, 'MINT', 5),
(402, 'MISS', 3), (403, 'MIST', 4), (404, 'MOAN', 4), (405, 'MOCK', 5), (406, 'MODE', 3), (407, 'MOLD', 4),
(408, 'MOLE', 3), (409, 'MOOD', 4), (410, 'MOON', 4), (411, 'MORE', 3), (412, 'MOST', 3), (413, 'MOVE', 3),
(414, 'MUCH', 4), (415, 'MUCK', 5), (416, 'MUGS', 4), (417, 'MUST', 4), (418, 'MYTH', 4), (419, 'NAIL', 6),
(420, 'NAME', 4), (421, 'NEAR', 6), (422, 'NEAT', 5), (423, 'NECK', 6), (424, 'NEED', 6), (425, 'NEST', 4),
(426, 'NETS', 4), (427, 'NEWS', 4), (428, 'NEXT', 5), (429, 'NICE', 4), (430, 'NICK', 5), (431, 'NINE', 3),
(432, 'NOON', 5), (433, 'NORM', 5), (434, 'NOUN', 5), (435, 'NULL', 5), (436, 'NUNS', 5), (437, 'NUTS', 4),
(438, 'ONLY', 6), (439, 'OPUS', 6), (440, 'OURS', 5), (441, 'OWES', 6), (442, 'OWNS', 5), (443, 'PACE', 3),
(444, 'PACK', 4), (445, 'PADS', 4), (446, 'PAGE', 3), (447, 'PAID', 5), (448, 'PAIN', 6), (449, 'PAIR', 5),
(450, 'PALE', 3), (451, 'PANT', 4), (452, 'PARK', 4), (453, 'PART', 4), (454, 'PASS', 3), (455, 'PAST', 3),
(456, 'PATH', 4), (457, 'PAYS', 4), (458, 'PEAK', 5), (459, 'PEER', 6), (460, 'PENS', 4), (461, 'PICK', 5),
(462, 'PIGS', 4), (463, 'PILE', 3), (464, 'PILL', 4), (465, 'PINK', 4), (466, 'PINS', 4), (467, 'PINT', 4),
(468, 'PIPE', 3), (469, 'PITY', 5), (470, 'PLAN', 6), (471, 'PLOT', 6), (472, 'PLOY', 6), (473, 'POEM', 4),
(474, 'POET', 3), (475, 'POLL', 3), (476, 'POOL', 4), (477, 'POOR', 4), (478, 'POPS', 3), (479, 'PORK', 3),
(480, 'PORT', 3), (481, 'POUR', 4), (482, 'PRAY', 6), (483, 'PULL', 4), (484, 'PULP', 4), (485, 'PUMP', 4),
(486, 'PUNS', 4), (487, 'PUNT', 5), (488, 'PURE', 3), (489, 'PUSH', 3), (490, 'PUTS', 4), (491, 'RACE', 4),
(492, 'RACK', 5), (493, 'RAGE', 4), (494, 'RAID', 6), (495, 'RAIL', 5), (496, 'RAIN', 6), (497, 'RANG', 5),
(498, 'RANK', 5), (499, 'RANT', 5), (500, 'RARE', 4), (501, 'RASH', 4), (502, 'RATE', 3), (503, 'RATS', 4),
(504, 'RAVE', 3), (505, 'READ', 5), (506, 'REAL', 6), (507, 'REAR', 6), (508, 'RENT', 5), (509, 'REST', 4),
(510, 'RICE', 3), (511, 'RICH', 4), (512, 'RIDE', 3), (513, 'RING', 5), (514, 'RIOT', 5), (515, 'RIPS', 4),
(516, 'RISK', 3), (517, 'ROAD', 5), (518, 'ROCK', 5), (519, 'ROLL', 3), (520, 'ROOF', 5), (521, 'ROOM', 5),
(522, 'ROOT', 4), (523, 'ROUT', 4), (524, 'ROWS', 4), (525, 'RUDE', 3), (526, 'RULE', 3), (527, 'RUNG', 4),
(528, 'RUNS', 4), (529, 'RUSH', 3), (530, 'SACK', 5), (531, 'SAFE', 4), (532, 'SAGA', 5), (533, 'SAID', 6),
(534, 'SAIL', 6), (535, 'SAKE', 3), (536, 'SALE', 4), (537, 'SALT', 5), (538, 'SAME', 4), (539, 'SAND', 5),
(540, 'SANE', 4), (541, 'SANG', 5), (542, 'SANK', 5), (543, 'SAVE', 4), (544, 'SAYS', 4), (545, 'SEAL', 6),
(546, 'SEAT', 5), (547, 'SEED', 6), (548, 'SEEK', 6), (549, 'SEEM', 6), (550, 'SEEN', 6), (551, 'SEES', 5),
(552, 'SELF', 6), (553, 'SELL', 5), (554, 'SEND', 5), (555, 'SENT', 5), (556, 'SETS', 4), (557, 'SHOE', 6),
(558, 'SHOP', 6), (559, 'SHOT', 5), (560, 'SHOW', 6), (561, 'SHUT', 6), (562, 'SIDE', 4), (563, 'SIGH', 6),
(564, 'SINE', 4), (565, 'SING', 5), (566, 'SINK', 5), (567, 'SITE', 4), (568, 'SITS', 4), (569, 'SIZE', 4),
(570, 'SLOT', 5), (571, 'SLOW', 6), (572, 'SNOW', 6), (573, 'SOAP', 6), (574, 'SOCK', 5), (575, 'SOFT', 4),
(576, 'SOIL', 5), (577, 'SOLD', 4), (578, 'SOLE', 3), (579, 'SOLO', 4), (580, 'SOME', 3), (581, 'SONG', 4),
(582, 'SONS', 4), (583, 'SOON', 5), (584, 'SORE', 3), (585, 'SORT', 4), (586, 'SOUL', 5), (587, 'SOUP', 5),
(588, 'SPIT', 6), (589, 'SPOT', 5), (590, 'SPUR', 6), (591, 'STAR', 6), (592, 'SUCH', 5), (593, 'SUIT', 6),
(594, 'SUMS', 5), (595, 'SUNG', 5), (596, 'SUNK', 5), (597, 'SURE', 4), (598, 'TABS', 4), (599, 'TACK', 5),
(600, 'TAIL', 6), (601, 'TAKE', 3), (602, 'TALE', 4), (603, 'TALK', 5), (604, 'TALL', 5), (605, 'TAME', 4),
(606, 'TANK', 5), (607, 'TAPE', 4), (608, 'TASK', 4), (609, 'TAXI', 6), (610, 'TEAM', 6), (611, 'TEAR', 6),
(612, 'TELL', 5), (613, 'TEND', 5), (614, 'TENS', 4), (615, 'TERM', 6), (616, 'TEST', 4), (617, 'TEXT', 5),
(618, 'THAT', 6), (619, 'THEM', 6), (620, 'THEN', 6), (621, 'THIS', 6), (622, 'THUS', 5), (623, 'TICK', 5),
(624, 'TIDY', 5), (625, 'TIED', 5), (626, 'TIES', 4), (627, 'TILE', 4), (628, 'TILL', 5), (629, 'TIME', 4),
(630, 'TINS', 4), (631, 'TINY', 5), (632, 'TIPS', 4), (633, 'TIRE', 4), (634, 'TOAD', 5), (635, 'TOES', 3),
(636, 'TOLD', 4), (637, 'TOLL', 4), (638, 'TOME', 3), (639, 'TONE', 3), (640, 'TONS', 3), (641, 'TOOK', 5),
(642, 'TOOL', 5), (643, 'TOPS', 3), (644, 'TORE', 3), (645, 'TORN', 4), (646, 'TOUR', 5), (647, 'TOWN', 4),
(648, 'TOYS', 3), (649, 'TRAY', 6), (650, 'TUBE', 4), (651, 'TUNE', 4), (652, 'TURN', 5), (653, 'TYPE', 4),
(654, 'VAIN', 6), (655, 'VANS', 5), (656, 'VARY', 6), (657, 'VAST', 4), (658, 'VEND', 6), (659, 'VERB', 6),
(660, 'VICE', 4), (661, 'VIEW', 6), (662, 'VOTE', 3), (663, 'WADE', 4), (664, 'WAGE', 4), (665, 'WAIT', 5),
(666, 'WAKE', 3), (667, 'WALK', 5), (668, 'WALL', 5), (669, 'WANT', 5), (670, 'WARD', 5), (671, 'WARM', 5),
(672, 'WARN', 5), (673, 'WARP', 5), (674, 'WARY', 5), (675, 'WASH', 4), (676, 'WAVE', 4), (677, 'WAYS', 4),
(678, 'WEAK', 6), (679, 'WEAR', 6), (680, 'WEEK', 6), (681, 'WELL', 5), (682, 'WENT', 5), (683, 'WERE', 4),
(684, 'WEST', 4), (685, 'WHAT', 6), (686, 'WIDE', 4), (687, 'WIFE', 4), (688, 'WILD', 5), (689, 'WILL', 5),
(690, 'WIND', 5), (691, 'WING', 5), (692, 'WINS', 5), (693, 'WIPE', 4), (694, 'WIRE', 4), (695, 'WISE', 3),
(696, 'WISH', 4), (697, 'WITH', 5), (698, 'WOLF', 5), (699, 'WOOD', 5), (700, 'WORD', 4), (701, 'WORE', 3),
(702, 'WORK', 4), (703, 'WORM', 4), (704, 'WORN', 4), (705, 'YARD', 5), (706, 'YAWN', 6), (707, 'YEAR', 6),
(708, 'YOUR', 5), (709, 'ZERO', 6), (710, 'ZONE', 3), (711, 'ZOOM', 5);

-- ---------------------------------------------------------------- helpers

create or replace function public.josele_today() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

-- FNV-1a 32-bit, identical to hash() in js/engine.js.
create or replace function public.josele_hash(p_text text) returns bigint
language plpgsql immutable set search_path = public as $$
declare
  h bigint := 2166136261;
  b bytea := convert_to(p_text, 'UTF8');
begin
  for i in 0 .. length(b) - 1 loop
    h := ((h # get_byte(b, i)::bigint) * 16777619) % 4294967296;
  end loop;
  return h;
end
$$;

-- The start word for a date, identical to pickStart() in js/engine.js.
create or replace function public.josele_start(p_day date) returns public.start_words
language plpgsql stable set search_path = public as $$
declare
  n integer;
  i integer;
  s public.start_words;
begin
  select count(*) into n from start_words;
  i := (josele_hash('josele:' || to_char(p_day, 'YYYY-MM-DD')) % n)::integer;
  if n > 1 and i = (josele_hash('josele:' || to_char(p_day - 1, 'YYYY-MM-DD')) % n)::integer then
    i := (i + 1) % n;
  end if;
  select * into s from start_words where idx = i;
  return s;
end
$$;

create or replace function public.josele_is_offensive(p_text text) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  folded text := lower(translate(p_text, 'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñ0134578', 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnoieastb'));
  squashed text := replace(replace(folded, ' ', ''), '_', '');
begin
  return exists (select 1 from unnest(array['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fagg', 'whore', 'slut', 'pussy', 'asshole', 'bastard', 'nazi', 'hitler', 'penis', 'vagina', 'porn', 'retard', 'wank', 'rapist', 'caralho', 'karalho', 'porra', 'buceta', 'boceta', 'xoxota', 'viado', 'merda', 'bosta', 'cuzao', 'foda', 'fode', 'fudid', 'piroca', 'punheta', 'arrombad', 'vagabund', 'desgraca', 'otario', 'babaca', 'vadia', 'estupr']) b where position(b in squashed) > 0)
      or string_to_array(replace(folded, '_', ' '), ' ') && array['ass', 'sex', 'sexo', 'cock', 'dick', 'fag', 'rape', 'twat', 'prick', 'tits', 'boobs', 'anal', 'anus', 'cum', 'kkk', 'hoe', 'cu', 'pau', 'puta', 'putas', 'puto', 'bicha', 'corno', 'fdp', 'vsf', 'pqp', 'crl', 'krl'];
end
$$;

-- Same rules as validate() in js/names.js. Returns the cleaned name or raises.
create or replace function public.josele_clean_name(p_name text) returns text
language plpgsql immutable set search_path = public as $$
declare
  v text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if v = '' then raise exception 'Please type a name'; end if;
  if char_length(v) > 15 then raise exception 'Name is too long'; end if;
  if v !~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 ]+$' then raise exception 'Letters, numbers and spaces only'; end if;
  if josele_is_offensive(v) then raise exception 'Please pick another name'; end if;
  return v;
end
$$;

-- Same rules as validateUsername() in js/names.js.
create or replace function public.josele_clean_username(p_username text) returns text
language plpgsql immutable set search_path = public as $$
declare
  v text := btrim(coalesce(p_username, ''));
begin
  if char_length(v) < 3 or char_length(v) > 15 then
    raise exception 'Username must be 3 to 15 characters';
  end if;
  if v !~ '^[A-Za-z0-9_]+$' then raise exception 'Username: letters, numbers and _ only'; end if;
  if lower(v) = any (array['jose', 'josele']) then raise exception 'That username is reserved'; end if;
  if josele_is_offensive(v) then raise exception 'Please pick another username'; end if;
  return v;
end
$$;

-- The player this browser is currently playing as (null if none yet).
create or replace function public.josele_player() returns uuid
language sql stable security definer set search_path = public as $$
  select player_id from player_links where auth_uid = auth.uid()
$$;

-- Rebuilds a player's streaks from their stored results.
create or replace function public.josele_recompute(p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_last date;
  v_current integer := 0;
  v_best integer := 0;
begin
  with d as (
    select day, day - (row_number() over (order by day))::integer as grp
    from results where player_id = p_player
  ), runs as (
    select max(day) as last_day, count(*)::integer as len from d group by grp
  )
  select (select last_day from runs order by last_day desc limit 1),
         coalesce((select len from runs order by last_day desc limit 1), 0),
         coalesce((select max(len) from runs), 0)
    into v_last, v_current, v_best;
  update players
     set last_solved = v_last,
         current_streak = v_current,
         best_streak = greatest(best_streak, v_best)
   where id = p_player;
end
$$;

-- ---------------------------------------------------------------- player API

create or replace function public.set_name(p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  pid uuid := josele_player();
  v text := josele_clean_name(p_name);
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if pid is null then
    insert into players (name) values (v) returning id into pid;
    insert into player_links (auth_uid, player_id) values (uid, pid);
  else
    update players set name = v where id = pid;
  end if;
  return v;
end
$$;

-- Checks a finished game and stores it. One result per player per day.
create or replace function public.submit_result(p_day date, p_path text[]) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := josele_player();
  today date := josele_today();
  n integer := coalesce(array_length(p_path, 1), 0);
  s public.start_words;
  diff integer;
  existing public.results;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if uid is null then raise exception 'Choose a name first'; end if;
  -- Only today's puzzle counts (with ten minutes of grace just after midnight).
  if p_day is null or not (p_day = today or (p_day = today - 1
      and (now() at time zone 'America/Sao_Paulo')::time < time '00:10')) then
    raise exception 'That puzzle is closed';
  end if;
  if array_ndims(p_path) is distinct from 1 or n < 2 or n > 201 then
    raise exception 'Invalid path';
  end if;

  s := josele_start(p_day);
  if p_path[1] is distinct from s.word then raise exception 'Wrong start word'; end if;
  if p_path[n] is distinct from 'JOSE' then raise exception 'Path does not end at JOSE'; end if;
  if (select count(distinct w) from unnest(p_path) w) <> n then
    raise exception 'A word was used twice';
  end if;
  for i in 2 .. n loop
    if p_path[i] is null or not exists (select 1 from valid_words where word = p_path[i]) then
      raise exception 'Not a valid word: %', coalesce(p_path[i], '?');
    end if;
    select count(*) into diff from generate_series(1, 4) k
     where substr(p_path[i], k, 1) <> substr(p_path[i - 1], k, 1);
    if diff <> 1 then
      raise exception 'More than one letter changed at step %', i - 1;
    end if;
  end loop;

  insert into results (player_id, day, steps, optimal, path)
  values (uid, p_day, n - 1, s.optimal, p_path)
  on conflict (player_id, day) do nothing;
  perform josele_recompute(uid);

  select * into existing from results where player_id = uid and day = p_day;
  return json_build_object('day', existing.day, 'steps', existing.steps, 'optimal', existing.optimal);
end
$$;

-- Everything the game needs to restore a player on a new device.
create or replace function public.my_profile() returns json
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := josele_player();
  today date := josele_today();
  p public.players;
begin
  if auth.uid() is null then return null; end if;
  select * into p from players where id = uid;
  return json_build_object(
    'name', p.name,
    'username', p.username,
    'guest', p.username is null,
    'today', today,
    'current_streak', case when p.last_solved >= today - 1 then p.current_streak else 0 end,
    'best_streak', coalesce(p.best_streak, 0),
    'last_solved', p.last_solved,
    'played', (select count(*) from results where player_id = uid),
    'optimal', (select count(*) from results where player_id = uid and steps <= optimal),
    'dist', (select json_build_array(
        count(*) filter (where steps - optimal <= 0),
        count(*) filter (where steps - optimal = 1),
        count(*) filter (where steps - optimal = 2),
        count(*) filter (where steps - optimal >= 3))
      from results where player_id = uid),
    'today_path', (select to_json(path) from results where player_id = uid and day = today)
  );
end
$$;

-- ---------------------------------------------------------------- accounts

-- Turns the current guest into an account. Their name and results stay with them.
create or replace function public.sign_up(p_name text, p_username text, p_password text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := auth.uid();
  pid uuid := josele_player();
  v_name text := josele_clean_name(p_name);
  v_user text := josele_clean_username(p_username);
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if p_password is null or char_length(p_password) < 6 then
    raise exception 'Password must be at least 6 characters';
  end if;
  if char_length(p_password) > 72 then raise exception 'Password is too long'; end if;
  if pid is not null and exists (select 1 from players where id = pid and username is not null) then
    raise exception 'You are already logged in';
  end if;
  if exists (select 1 from players where lower(username) = lower(v_user)) then
    raise exception 'That username is taken';
  end if;
  if pid is null then
    insert into players (name) values (v_name) returning id into pid;
    insert into player_links (auth_uid, player_id) values (uid, pid);
  end if;
  begin
    update players set name = v_name, username = v_user,
           pass_hash = crypt(p_password, gen_salt('bf', 10))
     where id = pid;
  exception when unique_violation then
    raise exception 'That username is taken';
  end;
  return my_profile();
end
$$;

-- Points this browser at an existing account. Guest progress made on this browser
-- before logging in is moved into the account.
create or replace function public.log_in(p_username text, p_password text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := auth.uid();
  cur uuid := josele_player();
  key text := lower(btrim(coalesce(p_username, '')));
  target public.players;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  delete from login_attempts where at < now() - interval '1 day';
  if (select count(*) from login_attempts where username = key and at > now() - interval '10 minutes') >= 8 then
    return json_build_object('error', 'Too many tries. Wait a few minutes and try again.');
  end if;
  select * into target from players where lower(username) = key;
  if target.id is null or target.pass_hash is null
     or target.pass_hash <> crypt(coalesce(p_password, ''), target.pass_hash) then
    insert into login_attempts (username) values (key);
    return json_build_object('error', 'Wrong username or password');
  end if;
  delete from login_attempts where username = key;

  if cur is distinct from target.id then
    if cur is not null and exists (select 1 from players where id = cur and username is null) then
      insert into results (player_id, day, steps, optimal, path, finished_at)
      select target.id, day, steps, optimal, path, finished_at from results where player_id = cur
      on conflict (player_id, day) do nothing;
      delete from players where id = cur;   -- the guest; its link and results go with it
    end if;
    insert into player_links (auth_uid, player_id) values (uid, target.id)
    on conflict (auth_uid) do update set player_id = excluded.player_id;
    perform josele_recompute(target.id);
  end if;
  return my_profile();
end
$$;

-- This browser stops playing as the account (the account itself is untouched).
create or replace function public.log_out() returns void
language sql security definer set search_path = public as $$
  delete from player_links where auth_uid = auth.uid()
$$;

-- ---------------------------------------------------------------- leaderboards

create or replace function public.leaderboard_today() returns json
language sql stable security definer set search_path = public as $$
  with r as (
    select res.player_id, pl.name, res.steps, res.steps <= res.optimal as star,
           row_number() over (order by res.steps, res.finished_at, res.player_id) as rank
    from results res join players pl on pl.id = res.player_id
    where res.day = josele_today()
  )
  select json_build_object(
    'day', josele_today(),
    'total', (select count(*) from r),
    'rows', coalesce((select json_agg(json_build_object(
        'rank', rank, 'name', name, 'steps', steps, 'star', star,
        'me', coalesce(player_id = josele_player(), false)) order by rank) from r where rank <= 50), '[]'::json),
    'me', (select json_build_object('rank', rank, 'name', name, 'steps', steps, 'star', star, 'me', true)
           from r where player_id = josele_player())
  )
$$;

create or replace function public.leaderboard_streaks() returns json
language sql stable security definer set search_path = public as $$
  with s as (
    select id, name, best_streak as best,
           case when last_solved >= josele_today() - 1 then current_streak else 0 end as current
    from players
  ), r as (
    select *, row_number() over (order by current desc, best desc, name, id) as rank
    from s where current > 0
  )
  select json_build_object(
    'total', (select count(*) from r),
    'rows', coalesce((select json_agg(json_build_object(
        'rank', rank, 'name', name, 'current', current, 'best', best,
        'me', coalesce(id = josele_player(), false)) order by rank) from r where rank <= 50), '[]'::json),
    'me', (select json_build_object(
        'rank', (select rank from r where r.id = s.id),
        'name', name, 'current', current, 'best', best, 'me', true)
      from s where id = josele_player())
  )
$$;

-- ---------------------------------------------------------------- permissions

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.leaderboard_today(), public.leaderboard_streaks()
  to anon, authenticated;
grant execute on function public.set_name(text), public.submit_result(date, text[]),
  public.my_profile(), public.sign_up(text, text, text), public.log_in(text, text),
  public.log_out()
  to authenticated;
