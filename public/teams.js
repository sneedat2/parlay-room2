// Team badges: abbreviation + team colors, keyed by the team names The Odds API uses.
// Colors only (no league logos, which are trademarks). Unknown teams (e.g. colleges) get a
// generated abbreviation and a steady color, so every game still gets a badge.

/* [abbreviation, primary color, secondary color] */
const TEAM_BADGES = {
  // NFL
  'Arizona Cardinals': ['ARI', '#97233F', '#FFB612'], 'Atlanta Falcons': ['ATL', '#A71930', '#000000'],
  'Baltimore Ravens': ['BAL', '#241773', '#9E7C0C'], 'Buffalo Bills': ['BUF', '#00338D', '#C60C30'],
  'Carolina Panthers': ['CAR', '#0085CA', '#101820'], 'Chicago Bears': ['CHI', '#0B162A', '#C83803'],
  'Cincinnati Bengals': ['CIN', '#FB4F14', '#000000'], 'Cleveland Browns': ['CLE', '#311D00', '#FF3C00'],
  'Dallas Cowboys': ['DAL', '#003594', '#869397'], 'Denver Broncos': ['DEN', '#FB4F14', '#002244'],
  'Detroit Lions': ['DET', '#0076B6', '#B0B7BC'], 'Green Bay Packers': ['GB', '#203731', '#FFB612'],
  'Houston Texans': ['HOU', '#03202F', '#A71930'], 'Indianapolis Colts': ['IND', '#002C5F', '#A2AAAD'],
  'Jacksonville Jaguars': ['JAX', '#006778', '#D7A22A'], 'Kansas City Chiefs': ['KC', '#E31837', '#FFB81C'],
  'Las Vegas Raiders': ['LV', '#000000', '#A5ACAF'], 'Los Angeles Chargers': ['LAC', '#0080C6', '#FFC20E'],
  'Los Angeles Rams': ['LAR', '#003594', '#FFA300'], 'Miami Dolphins': ['MIA', '#008E97', '#FC4C02'],
  'Minnesota Vikings': ['MIN', '#4F2683', '#FFC62F'], 'New England Patriots': ['NE', '#002244', '#C60C30'],
  'New Orleans Saints': ['NO', '#101820', '#D3BC8D'], 'New York Giants': ['NYG', '#0B2265', '#A71930'],
  'New York Jets': ['NYJ', '#125740', '#FFFFFF'], 'Philadelphia Eagles': ['PHI', '#004C54', '#A5ACAF'],
  'Pittsburgh Steelers': ['PIT', '#101820', '#FFB612'], 'San Francisco 49ers': ['SF', '#AA0000', '#B3995D'],
  'Seattle Seahawks': ['SEA', '#002244', '#69BE28'], 'Tampa Bay Buccaneers': ['TB', '#D50A0A', '#34302B'],
  'Tennessee Titans': ['TEN', '#0C2340', '#4B92DB'], 'Washington Commanders': ['WSH', '#5A1414', '#FFB612'],

  // NBA
  'Atlanta Hawks': ['ATL', '#E03A3E', '#C1D32F'], 'Boston Celtics': ['BOS', '#007A33', '#BA9653'],
  'Brooklyn Nets': ['BKN', '#000000', '#FFFFFF'], 'Charlotte Hornets': ['CHA', '#1D1160', '#00788C'],
  'Chicago Bulls': ['CHI', '#CE1141', '#000000'], 'Cleveland Cavaliers': ['CLE', '#860038', '#FDBB30'],
  'Dallas Mavericks': ['DAL', '#00538C', '#B8C4CA'], 'Denver Nuggets': ['DEN', '#0E2240', '#FEC524'],
  'Detroit Pistons': ['DET', '#C8102E', '#1D42BA'], 'Golden State Warriors': ['GSW', '#1D428A', '#FFC72C'],
  'Houston Rockets': ['HOU', '#CE1141', '#000000'], 'Indiana Pacers': ['IND', '#002D62', '#FDBB30'],
  'Los Angeles Clippers': ['LAC', '#C8102E', '#1D428A'], 'Los Angeles Lakers': ['LAL', '#552583', '#FDB927'],
  'Memphis Grizzlies': ['MEM', '#5D76A9', '#12173F'], 'Miami Heat': ['MIA', '#98002E', '#F9A01B'],
  'Milwaukee Bucks': ['MIL', '#00471B', '#EEE1C6'], 'Minnesota Timberwolves': ['MIN', '#0C2340', '#78BE20'],
  'New Orleans Pelicans': ['NOP', '#0C2340', '#C8102E'], 'New York Knicks': ['NYK', '#006BB6', '#F58426'],
  'Oklahoma City Thunder': ['OKC', '#007AC1', '#EF3B24'], 'Orlando Magic': ['ORL', '#0077C0', '#C4CED4'],
  'Philadelphia 76ers': ['PHI', '#006BB6', '#ED174C'], 'Phoenix Suns': ['PHX', '#1D1160', '#E56020'],
  'Portland Trail Blazers': ['POR', '#E03A3E', '#000000'], 'Sacramento Kings': ['SAC', '#5A2D81', '#63727A'],
  'San Antonio Spurs': ['SAS', '#000000', '#C4CED4'], 'Toronto Raptors': ['TOR', '#CE1141', '#000000'],
  'Utah Jazz': ['UTA', '#002B5C', '#F9A01B'], 'Washington Wizards': ['WAS', '#002B5C', '#E31837'],

  // MLB
  'Arizona Diamondbacks': ['ARI', '#A71930', '#E3D4AD'], 'Atlanta Braves': ['ATL', '#CE1141', '#13274F'],
  'Baltimore Orioles': ['BAL', '#DF4601', '#000000'], 'Boston Red Sox': ['BOS', '#BD3039', '#0C2340'],
  'Chicago Cubs': ['CHC', '#0E3386', '#CC3433'], 'Chicago White Sox': ['CWS', '#27251F', '#C4CED4'],
  'Cincinnati Reds': ['CIN', '#C6011F', '#000000'], 'Cleveland Guardians': ['CLE', '#00385D', '#E50022'],
  'Colorado Rockies': ['COL', '#33006F', '#C4CED4'], 'Detroit Tigers': ['DET', '#0C2340', '#FA4616'],
  'Houston Astros': ['HOU', '#002D62', '#EB6E1F'], 'Kansas City Royals': ['KC', '#004687', '#BD9B60'],
  'Los Angeles Angels': ['LAA', '#BA0021', '#003263'], 'Los Angeles Dodgers': ['LAD', '#005A9C', '#EF3E42'],
  'Miami Marlins': ['MIA', '#00A3E0', '#EF3340'], 'Milwaukee Brewers': ['MIL', '#12284B', '#FFC52F'],
  'Minnesota Twins': ['MIN', '#002B5C', '#D31145'], 'New York Mets': ['NYM', '#002D72', '#FF5910'],
  'New York Yankees': ['NYY', '#0C2340', '#C4CED3'], 'Athletics': ['ATH', '#003831', '#EFB21E'],
  'Oakland Athletics': ['ATH', '#003831', '#EFB21E'], 'Philadelphia Phillies': ['PHI', '#E81828', '#002D72'],
  'Pittsburgh Pirates': ['PIT', '#27251F', '#FDB827'], 'San Diego Padres': ['SD', '#2F241D', '#FFC425'],
  'San Francisco Giants': ['SF', '#FD5A1E', '#27251F'], 'Seattle Mariners': ['SEA', '#0C2C56', '#005C5C'],
  'St. Louis Cardinals': ['STL', '#C41E3A', '#0C2340'], 'St Louis Cardinals': ['STL', '#C41E3A', '#0C2340'],
  'Tampa Bay Rays': ['TB', '#092C5C', '#8FBCE6'], 'Texas Rangers': ['TEX', '#003278', '#C0111F'],
  'Toronto Blue Jays': ['TOR', '#134A8E', '#E8291C'], 'Washington Nationals': ['WSH', '#AB0003', '#14225A'],

  // NHL
  'Anaheim Ducks': ['ANA', '#F47A38', '#000000'], 'Boston Bruins': ['BOS', '#FFB81C', '#000000'],
  'Buffalo Sabres': ['BUF', '#002654', '#FCB514'], 'Calgary Flames': ['CGY', '#C8102E', '#F1BE48'],
  'Carolina Hurricanes': ['CAR', '#CE1126', '#000000'], 'Chicago Blackhawks': ['CHI', '#CF0A2C', '#000000'],
  'Colorado Avalanche': ['COL', '#6F263D', '#236192'], 'Columbus Blue Jackets': ['CBJ', '#002654', '#CE1126'],
  'Dallas Stars': ['DAL', '#006847', '#8F8F8C'], 'Detroit Red Wings': ['DET', '#CE1126', '#FFFFFF'],
  'Edmonton Oilers': ['EDM', '#041E42', '#FF4C00'], 'Florida Panthers': ['FLA', '#041E42', '#C8102E'],
  'Los Angeles Kings': ['LAK', '#111111', '#A2AAAD'], 'Minnesota Wild': ['MIN', '#154734', '#A6192E'],
  'Montréal Canadiens': ['MTL', '#AF1E2D', '#192168'], 'Montreal Canadiens': ['MTL', '#AF1E2D', '#192168'],
  'Nashville Predators': ['NSH', '#FFB81C', '#041E42'], 'New Jersey Devils': ['NJD', '#CE1126', '#000000'],
  'New York Islanders': ['NYI', '#00539B', '#F47D30'], 'New York Rangers': ['NYR', '#0038A8', '#CE1126'],
  'Ottawa Senators': ['OTT', '#C52032', '#000000'], 'Philadelphia Flyers': ['PHI', '#F74902', '#000000'],
  'Pittsburgh Penguins': ['PIT', '#000000', '#FCB514'], 'San Jose Sharks': ['SJ', '#006D75', '#EA7200'],
  'Seattle Kraken': ['SEA', '#001628', '#99D9D9'], 'St Louis Blues': ['STL', '#002F87', '#FCB514'],
  'St. Louis Blues': ['STL', '#002F87', '#FCB514'], 'Tampa Bay Lightning': ['TB', '#002868', '#FFFFFF'],
  'Toronto Maple Leafs': ['TOR', '#00205B', '#FFFFFF'], 'Utah Hockey Club': ['UTA', '#6CACE4', '#000000'],
  'Utah Mammoth': ['UTA', '#6CACE4', '#000000'], 'Vancouver Canucks': ['VAN', '#00205B', '#00843D'],
  'Vegas Golden Knights': ['VGK', '#B4975A', '#333F42'], 'Washington Capitals': ['WSH', '#041E42', '#C8102E'],
  'Winnipeg Jets': ['WPG', '#041E42', '#004C97'],

  // WNBA
  'Atlanta Dream': ['ATL', '#E31837', '#5091CD'], 'Chicago Sky': ['CHI', '#418FDE', '#FFCD00'],
  'Connecticut Sun': ['CON', '#0C2340', '#F05023'], 'Dallas Wings': ['DAL', '#0C2340', '#C4D600'],
  'Golden State Valkyries': ['GSV', '#3F2A56', '#000000'], 'Indiana Fever': ['IND', '#002D62', '#E03A3E'],
  'Las Vegas Aces': ['LV', '#000000', '#BA0C2F'], 'Los Angeles Sparks': ['LA', '#552583', '#FDB927'],
  'Minnesota Lynx': ['MIN', '#0C2340', '#266092'], 'New York Liberty': ['NY', '#86CEBC', '#000000'],
  'Phoenix Mercury': ['PHX', '#201747', '#CB6015'], 'Seattle Storm': ['SEA', '#2C5235', '#FEE11A'],
  'Washington Mystics': ['WAS', '#002B5C', '#E03A3E'],

  // College (football and basketball programs that get the most action)
  'Alabama Crimson Tide': ['ALA', '#9E1B32', '#828A8F'], 'Arizona Wildcats': ['ARIZ', '#CC0033', '#003366'],
  'Arizona State Sun Devils': ['ASU', '#8C1D40', '#FFC627'], 'Arkansas Razorbacks': ['ARK', '#9D2235', '#FFFFFF'],
  'Army Black Knights': ['ARMY', '#000000', '#D4BF91'], 'Auburn Tigers': ['AUB', '#0C2340', '#E87722'],
  'Baylor Bears': ['BAY', '#154734', '#FFB81C'], 'Boise State Broncos': ['BSU', '#0033A0', '#D64309'],
  'Boston College Eagles': ['BC', '#98002E', '#BC9B6A'], 'BYU Cougars': ['BYU', '#002E5D', '#FFFFFF'],
  'California Golden Bears': ['CAL', '#003262', '#FDB515'], 'Cincinnati Bearcats': ['CIN', '#E00122', '#000000'],
  'Clemson Tigers': ['CLEM', '#F56600', '#522D80'], 'Colorado Buffaloes': ['COLO', '#000000', '#CFB87C'],
  'Creighton Bluejays': ['CREI', '#005CA9', '#FFFFFF'], 'Duke Blue Devils': ['DUKE', '#003087', '#FFFFFF'],
  'Florida Gators': ['FLA', '#0021A5', '#FA4616'], 'Florida State Seminoles': ['FSU', '#782F40', '#CEB888'],
  'Georgia Bulldogs': ['UGA', '#BA0C2F', '#000000'], 'Georgia Tech Yellow Jackets': ['GT', '#003057', '#B3A369'],
  'Gonzaga Bulldogs': ['GONZ', '#041E42', '#C8102E'], 'Houston Cougars': ['HOU', '#C8102E', '#FFFFFF'],
  'Illinois Fighting Illini': ['ILL', '#13294B', '#E84A27'], 'Indiana Hoosiers': ['IND', '#990000', '#FFFFFF'],
  'Iowa Hawkeyes': ['IOWA', '#000000', '#FFCD00'], 'Iowa State Cyclones': ['ISU', '#C8102E', '#F1BE48'],
  'Kansas Jayhawks': ['KU', '#0051BA', '#E8000D'], 'Kansas State Wildcats': ['KSU', '#512888', '#FFFFFF'],
  'Kentucky Wildcats': ['UK', '#0033A0', '#FFFFFF'], 'LSU Tigers': ['LSU', '#461D7C', '#FDD023'],
  'Louisville Cardinals': ['LOU', '#AD0000', '#000000'], 'Marquette Golden Eagles': ['MARQ', '#003366', '#FFCC00'],
  'Maryland Terrapins': ['MD', '#E03a3E', '#FFD520'], 'Memphis Tigers': ['MEM', '#003087', '#898D8D'],
  'Miami Hurricanes': ['MIA', '#F47321', '#005030'], 'Michigan Wolverines': ['MICH', '#00274C', '#FFCB05'],
  'Michigan State Spartans': ['MSU', '#18453B', '#FFFFFF'], 'Minnesota Golden Gophers': ['MINN', '#7A0019', '#FFCC33'],
  'Mississippi State Bulldogs': ['MSST', '#5D1725', '#FFFFFF'], 'Missouri Tigers': ['MIZ', '#000000', '#F1B82D'],
  'Navy Midshipmen': ['NAVY', '#00205B', '#C5B783'], 'NC State Wolfpack': ['NCST', '#CC0000', '#000000'],
  'Nebraska Cornhuskers': ['NEB', '#E41C38', '#FFFFFF'], 'North Carolina Tar Heels': ['UNC', '#7BAFD4', '#13294B'],
  'Northwestern Wildcats': ['NU', '#4E2A84', '#FFFFFF'], 'Notre Dame Fighting Irish': ['ND', '#0C2340', '#C99700'],
  'Ohio State Buckeyes': ['OSU', '#BB0000', '#666666'], 'Oklahoma Sooners': ['OU', '#841617', '#FDF9D8'],
  'Oklahoma State Cowboys': ['OKST', '#FF7300', '#000000'], 'Ole Miss Rebels': ['MISS', '#CE1126', '#14213D'],
  'Oregon Ducks': ['ORE', '#154733', '#FEE123'], 'Oregon State Beavers': ['ORST', '#DC4405', '#000000'],
  'Penn State Nittany Lions': ['PSU', '#041E42', '#FFFFFF'], 'Pittsburgh Panthers': ['PITT', '#003594', '#FFB81C'],
  'Purdue Boilermakers': ['PUR', '#000000', '#CFB991'], 'Rutgers Scarlet Knights': ['RUTG', '#CC0033', '#5F6A72'],
  'San Diego State Aztecs': ['SDSU', '#A6192E', '#000000'], 'SMU Mustangs': ['SMU', '#0033A0', '#C8102E'],
  'South Carolina Gamecocks': ['SC', '#73000A', '#000000'], "St. John's Red Storm": ['SJU', '#BA0C2F', '#FFFFFF'],
  'Stanford Cardinal': ['STAN', '#8C1515', '#FFFFFF'], 'Syracuse Orange': ['SYR', '#F76900', '#000E54'],
  'TCU Horned Frogs': ['TCU', '#4D1979', '#A3A9AC'], 'Tennessee Volunteers': ['TENN', '#FF8200', '#58595B'],
  'Texas Longhorns': ['TEX', '#BF5700', '#FFFFFF'], 'Texas A&M Aggies': ['TAMU', '#500000', '#FFFFFF'],
  'Texas Tech Red Raiders': ['TTU', '#CC0000', '#000000'], 'UCF Knights': ['UCF', '#000000', '#BA9B37'],
  'UCLA Bruins': ['UCLA', '#2D68C4', '#F2A900'], 'UConn Huskies': ['CONN', '#000E2F', '#FFFFFF'],
  'USC Trojans': ['USC', '#990000', '#FFC72C'], 'Utah Utes': ['UTAH', '#CC0000', '#FFFFFF'],
  'Vanderbilt Commodores': ['VAN', '#000000', '#866D4B'], 'Villanova Wildcats': ['NOVA', '#00205B', '#13B5EA'],
  'Virginia Cavaliers': ['UVA', '#232D4B', '#F84C1E'], 'Virginia Tech Hokies': ['VT', '#630031', '#CF4420'],
  'Wake Forest Demon Deacons': ['WAKE', '#000000', '#9E7E38'], 'Washington Huskies': ['WASH', '#4B2E83', '#B7A57A'],
  'West Virginia Mountaineers': ['WVU', '#002855', '#EAAA00'], 'Wisconsin Badgers': ['WIS', '#C5050C', '#FFFFFF'],
  'Xavier Musketeers': ['XAV', '#0C2340', '#9EA2A2'],
};

// Mascots that are two words, so "Alabama Crimson Tide" -> school "Alabama", not "Alabama Crimson".
const TWO_WORD_MASCOTS = /\s(Crimson Tide|Nittany Lions|Fighting Irish|Fighting Illini|Blue Devils|Tar Heels|Yellow Jackets|Red Raiders|Golden Gophers|Sun Devils|Horned Frogs|Scarlet Knights|Demon Deacons|Mean Green|Green Wave|Golden Eagles|Black Knights|Wolf Pack|Rainbow Warriors|Ragin' Cajuns|Golden Bears|Golden Hurricane|Blue Raiders|Red Wolves|Golden Flashes|Thundering Herd|Blue Hens|Big Red|Red Storm|Golden Griffins|Black Bears|Fighting Hawks|Sun Belt|Blue Demons|Golden Grizzlies|Red Foxes|Mountain Hawks|Great Danes)$/;

// Anything not listed (smaller colleges): a neutral badge with sensible initials,
// e.g. "Appalachian State Mountaineers" -> "ASU", "Coastal Carolina Chanticleers" -> "CC".
function guessBadge(name) {
  const full = String(name || '?');
  const schoolPart = TWO_WORD_MASCOTS.test(full) ? full.replace(TWO_WORD_MASCOTS, '') : full.replace(/\s+\S+$/, '');
  const words = (schoolPart || full).replace(/[^A-Za-z0-9& ]/g, ' ').split(/\s+/).filter(Boolean);
  let abbr;
  if (words.length === 1) abbr = words[0].slice(0, 3);
  else if (words[words.length - 1] === 'State') abbr = `${words.slice(0, -1).map((w) => w[0]).join('')}SU`;
  else abbr = words.map((w) => w[0]).join('');
  let h = 0;
  for (const c of full) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return [abbr.toUpperCase().slice(0, 4), '#2A3530', `hsl(${h % 360} 55% 55%)`];
}

function teamInfo(name) {
  return TEAM_BADGES[name] || guessBadge(name);
}

// Light team colors (Liberty mint, Bruins gold) get dark text so the letters stay readable.
function readableOn(bg) {
  const m = /^#([0-9a-f]{6})$/i.exec(bg);
  if (!m) return '#FFFFFF';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111111' : '#FFFFFF';
}

// <span class="badge">BUF</span> in team colors.
function teamBadge(name, size = 'md') {
  const [abbr, primary, secondary] = teamInfo(name);
  const b = document.createElement('span');
  b.className = `team-badge ${size}`;
  b.textContent = abbr;
  b.style.background = primary;
  b.style.color = readableOn(primary);
  b.style.boxShadow = `inset 0 -3px 0 ${secondary}`;
  b.setAttribute('aria-hidden', 'true');
  return b;
}
