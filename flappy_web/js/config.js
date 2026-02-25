// js/config.js
export const GAME_CONFIG = {
  GW: 400,
  GH: 600,
  GRAVITY: 0.45,
  JUMP_FORCE: -9.5,
  PIPE_SPEED: 2.55,
  PIPE_GAP: 175,
  PIPE_WIDTH: 72,
  PIPE_INTERVAL: 1750,
  BIRD_SIZE: 60,
  COL_W: 70,
  SPIKES_MODE_PRICE: 1000
};

export const CHARACTERS = {
  bobby:    { name:'Bobby',     img:'bobby.png',    price:0,    col:'soundcloud.png', bonuses:[], desc:'brak bonusów', sfx: 'bobby' },
  bialek:   { name:'Bialek',    img:'bialek.png',   price:15,   col:'nina.png',       bonuses:['gap+10'], desc:'przelot +10px', sfx: 'bialek' },
  deadman:  { name:'Deadman',   img:'deadman.png',  price:45,   col:'grammy.png',     bonuses:['speed-5'], desc:'rury −5%', sfx: 'deadman' },
  krystian: { name:'Krystian',  img:'krystian.png', price:90,   col:'diormind.png',   bonuses:['extralife'], desc:'+1 życie', sfx: 'krystian' },
  johnny:   { name:'Johnny',    img:'johnny.png',   price:150,  col:'joint.png',      bonuses:['gap+10','speed-5'], desc:'przelot +10px, rury −5%', sfx: 'johnny' },
  kolin:    { name:'Kolin',     img:'kolin.png',    price:250,  col:'strzykawka.png', bonuses:['gap+20'], desc:'przelot +20px', sfx: 'mumia' },
  kutasa:   { name:'Kutasa',    img:'kutasa.png',   price:400,  col:'dziecko.png',    bonuses:['speed-10','extralife'], desc:'rury −10%, +1 życie', sfx: 'kutasa' },
  reczu:    { name:'Reczu',     img:'reczu.png',    price:550,  col:'kutas.png',      bonuses:['gap+20','speed-10'], desc:'przelot +20px, rury −10%', sfx: 'reczu' },
  szpachl:  { name:'Szpachl',   img:'szpachl.png',  price:750,  col:'scat.png',       bonuses:['double'], desc:'×2 punkty i monety', sfx: 'szpachl' },
  tom:      { name:'Tom',       img:'tom.png',      price:950,  col:'wozek.png',      bonuses:['extralife','double','speed-5'], desc:'+życie, ×2 pkt, rury −5%', sfx: 'tom' },
  majka:    { name:'Majka 👑',  img:'majka.png',    price:1200, col:'onlyfans.png',   bonuses:['gap+30','speed-15','double','extralife'], desc:'WSZYSTKO: −15%, +30px, ×2, +życie', special:true, sfx: 'majka' },
  cwel:     { name:'Cwel',      img:'cwel.png',     price:500,  col:'cwel_col.png',   bonuses:['gap+30'], desc:'przelot aż +30px', isFomo: true, sfx: 'cwel' }
};

export const CHAR_KEYS = Object.keys(CHARACTERS);
