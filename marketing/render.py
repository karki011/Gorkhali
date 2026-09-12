#!/usr/bin/env python3
"""Render the original Gorkhali banner and two ten-second motion graphics.
Requires Python 3, Pillow, numpy and ffmpeg. No network or provider calls.
Fonts are loaded locally; set GORKHALI_FONT_DIR for Arial .ttf files on other hosts.
"""
from pathlib import Path
from functools import lru_cache
import argparse
import os
import subprocess
import tempfile
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'marketing' / 'reels'
W, H, FPS, DURATION = 1080, 1920, 30, 10
INK = '#0C1714'
PANEL = '#15261F'
LIME = '#D9FE66'
PAPER = '#F2F0E6'
MUTED = '#A2B6A7'
FONT_DIR = Path(os.environ.get('GORKHALI_FONT_DIR', '/System/Library/Fonts/Supplemental'))

@lru_cache(maxsize=80)
def font(size, bold=True):
    names = ['Arial Black.ttf', 'Arial Bold.ttf'] if bold else ['Arial.ttf']
    candidates = [FONT_DIR / n for n in names]
    candidates += [Path('/usr/share/fonts/truetype/dejavu') / ('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')]
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    raise RuntimeError('Install Arial or DejaVu Sans, or set GORKHALI_FONT_DIR.')


def text(draw, xy, value, size, fill=PAPER, bold=True, width=None):
    f = font(size, bold)
    if width:
        while draw.textbbox((0, 0), value, font=f)[2] > width:
            size -= 1
            f = font(size, bold)
    draw.text(xy, value, font=f, fill=fill, anchor='lt')


def ease(x):
    x = max(0, min(1, x))
    return 1 - (1 - x) ** 3


def ridge(draw, y, color, offset=0, scale=1):
    points = [(0,y+110),(180,y+30),(280,y+90),(490,y-110),(620,y+20),(760,y-30),(1080,y+140)]
    for j in range(6):
        draw.line([(int(x*scale),int(yy*scale+offset+j*25)) for x,yy in points], fill=color, width=2)


def brand(draw, dark=False):
    c = INK if dark else PAPER
    draw.polygon([(88,270),(110,228),(132,270),(121,270),(110,250),(100,270)], fill=INK if dark else LIME)
    text(draw,(151,232),'GORKHALI',36,c)
    text(draw,(88,295),'BUILT FOR CLAUDE CODE',21, '#56695B' if dark else MUTED,False)


def card(draw, y, number, title, detail, progress=1, light=False, x=88, width=812):
    bg = '#E7E8DB' if light else PANEL
    stroke = '#B7C6AD' if light else '#344638'
    fg = INK if light else PAPER
    draw.rounded_rectangle((x,y,x+width,y+147),radius=24,fill=bg,outline=stroke,width=2)
    draw.rounded_rectangle((x+22,y+25,x+87,y+90),radius=18,fill=INK if light else LIME)
    text(draw,(x+35,y+41),number,24,PAPER if light else INK)
    text(draw,(x+113,y+25),title,37,fg,width=width-160)
    text(draw,(x+114,y+84),detail,24,'#56695B' if light else MUTED,False,width=width-160)
    if progress > 0:
        draw.line((x+26,y+131,x+26+(width-52)*progress,y+131),fill='#667D29' if light else LIME,width=3)


def base(t, light=False):
    im=Image.new('RGB',(W,H),PAPER if light else INK)
    d=ImageDraw.Draw(im)
    # Slow contour drift provides continuous motion without distracting from copy.
    ridge(d,1580,'#D8DCCE' if light else '#223A2A',offset=-t*4)
    for i in range(4):
        x=85+i*260
        d.line((x,0,x,H),fill='#EAEBE0' if light else '#13231B',width=1)
    d.rectangle((88,1590,900,1593),fill='#CED6C4' if light else '#33462F')
    d.rectangle((88,1590,88+812*min(t/10,1),1593),fill=INK if light else LIME)
    return im


def heading(d, lines, local, light=False, y=410, size=110, accent=None):
    for i,line in enumerate(lines):
        enter=ease((local-i*.07)/.42)
        dy=int((1-enter)*65)
        color=(INK if light else PAPER)
        if i==accent: color='#526920' if light else LIME
        text(d,(88,y+i*(size+12)+dy),line,size,color,width=812)


def endcard(d, local, light=False):
    fg=INK if light else PAPER
    accent=INK if light else LIME
    shift=int((1-ease(local/.45))*70)
    y=520+shift
    d.polygon([(88,y+80),(140,y-20),(192,y+80),(165,y+80),(140,y+30),(115,y+80)],fill=accent)
    text(d,(88,y+137),'GORKHALI',106,fg,width=815)
    text(d,(88,y+285),'YOUR NEXT PR.',62,fg)
    text(d,(88,y+363),'WITH A PROCESS.',62,fg,width=815)
    d.rounded_rectangle((88,y+505,605,y+590),radius=42,fill=accent)
    text(d,(124,y+530),'TRY IT ON GITHUB',28,PAPER if light else INK)
    text(d,(88,y+640),'github.com/karki011/Gorkhali',32,fg,False,width=810)
    text(d,(88,y+705),'Claude Code plugin  /  MIT',24,'#56695B' if light else MUTED,False)


def scene(kind,index,local,t):
    light=kind==2
    im=base(t,light)
    d=ImageDraw.Draw(im)
    brand(d,light)
    if kind==1:
        if index==0:
            heading(d,['CODE IS','JUST THE','START.'],local,accent=2)
            yy=990+int((1-ease(local/.6))*45)
            d.rounded_rectangle((88,yy,900,yy+185),radius=24,fill=PANEL,outline='#344638',width=2)
            text(d,(120,yy+34),'THE NEXT STEP?',26,MUTED,False)
            text(d,(120,yy+92),'A process behind the PR.',36,PAPER,width=744)
            text(d,(88,1300),'PLAN. BUILD. CHECK. REVIEW.',25,LIME,False)
        elif index==1:
            heading(d,['THREE ROLES.','CLEAR DUTIES.'],local,y=405,size=81,accent=1)
            for i,(title,detail) in enumerate([('Engineer','Implements the scoped task'),('Inspector','Runs repository checks'),('Auditor','Reviews independently')]):
                enter=ease((local-i*.25)/.5)
                card(d,760+i*178+int((1-enter)*40),f'0{i+1}',title,detail,enter)
            text(d,(88,1382),'ONE INTEGRATED RESULT.',26,MUTED,False)
        elif index==2:
            heading(d,['YOU APPROVE.','YOU MERGE.'],local,y=445,size=92,accent=1)
            card(d,830,'01','Approve the plan','Before implementation',ease(local/.6))
            card(d,1005,'02','Control the merge','After checks and review',ease((local-.25)/.6))
            text(d,(88,1320),'YOUR REPO. YOUR CALL.',28,LIME,False)
        else: endcard(d,local)
    else:
        if index==0:
            heading(d,['INTERRUPTED?','KEEP GOING.'],local,True,y=445,size=97,accent=1)
            y=895
            d.rounded_rectangle((88,y,900,y+270),radius=24,fill=INK)
            text(d,(120,y+42),'SESSION CHECKPOINT',25,LIME,False)
            for j,(label,value) in enumerate([('Plan','saved'),('Progress','recorded'),('Next step','ready to reconcile')]):
                text(d,(120,y+102+j*48),label,25,PAPER,False)
                text(d,(438,y+102+j*48),value,24,LIME,False,width=420)
            text(d,(88,1320),'PICK UP THE THREAD OF YOUR WORK.',24,INK,False,width=812)
        elif index==1:
            heading(d,['RECOVER.','RECONCILE.','RESUME.'],local,True,y=390,size=90,accent=2)
            for i,(title,detail) in enumerate([('Load the checkpoint','Find the last recorded state'),('Check Git reality','Mark changed evidence stale'),('Continue the plan','Reapprove if scope changed')]):
                enter=ease((local-i*.24)/.45)
                card(d,820+i*175+int((1-enter)*40),f'0{i+1}',title,detail,enter,True)
        elif index==2:
            heading(d,['BACK TO','THE BUILD.'],local,True,y=460,size=113,accent=1)
            d.rounded_rectangle((88,900,900,1060),radius=24,fill=INK)
            text(d,(125,942),'/gorkhali:resume',53,LIME,False,width=730)
            text(d,(88,1170),'Progress saved.',35,INK,False)
            text(d,(88,1230),'Git checked before continuing.',35,INK,False,width=812)
        else: endcard(d,local,True)
    return im


CUTS=[0,2.4,5.8,8.0,10.0]

def frame(kind,t):
    index=next((i for i in range(4) if CUTS[i]<=t<CUTS[i+1]),3)
    local=t-CUTS[index]
    current=scene(kind,index,local,t)
    if index>0 and local<.18:
        previous=scene(kind,index-1,CUTS[index]-CUTS[index-1],t)
        current=Image.blend(previous,current,ease(local/.18))
    return current


def banner():
    im=Image.new('RGB',(1600,800),INK)
    d=ImageDraw.Draw(im)
    ridge(d,660,'#203B29',scale=1.5)
    d.polygon([(72,120),(97,72),(122,120),(109,120),(97,97),(85,120)],fill=LIME)
    text(d,(140,79),'GORKHALI',42)
    text(d,(72,225),'YOUR NEXT PR.',94,PAPER,width=850)
    text(d,(72,338),'WITH A',94,LIME)
    text(d,(72,451),'PROCESS.',94,LIME)
    text(d,(76,635),'Built for Claude Code.',29,PAPER,False)
    text(d,(76,681),'Controlled by you.',29,MUTED,False)
    text(d,(984,95),'FROM REQUEST TO REVIEW',22,MUTED,False)
    for i,(title,detail) in enumerate([('Engineer','Builds the change'),('Inspector','Runs the checks'),('Auditor','Reviews independently')]):
        card(d,185+i*167,f'0{i+1}',title,detail,1,x=975,width=550)
    text(d,(985,727),'PLAN APPROVAL  /  HUMAN MERGE',20,LIME,False)
    (ROOT/'assets').mkdir(exist_ok=True)
    im.save(ROOT/'assets/gorkhali-hero.png',optimize=True)


def soundtrack(path,kind):
    sr=48000
    n=sr*DURATION
    output=np.zeros(n,dtype=np.float64)
    rng=np.random.default_rng(701+kind)
    notes=[146.83,174.61,220,261.63] if kind==1 else [164.81,196,246.94,293.66]
    def add(start,values):
        k=int(start*sr); end=min(n,k+len(values))
        if end>k: output[k:end]+=values[:end-k]
    for i in range(20):
        tt=np.arange(int(sr*.36))/sr
        kick=np.sin(2*np.pi*(43*tt+35*.03*(1-np.exp(-tt/.03))))*np.exp(-tt*17)*.38
        add(i*.5,kick)
        f=notes[(i*3+kind)%4]
        tt=np.arange(int(sr*.62))/sr
        pluck=(np.sin(2*np.pi*f*tt)+.24*np.sin(2*np.pi*2*f*tt))*np.exp(-tt*7)*np.minimum(tt/.008,1)*.14
        add(i*.5+.125,pluck)
    for i in range(40):
        tt=np.arange(int(sr*.06))/sr
        noise=rng.normal(0,1,len(tt));noise=np.diff(noise,prepend=0)
        add(i*.25,noise*np.exp(-tt*90)*.025)
    output=np.tanh(output)
    fade=np.minimum(np.arange(n)/(sr*.1),1)*np.minimum((n-1-np.arange(n))/(sr*.5),1)
    output*=fade
    stereo=np.column_stack((output,output*.96))
    with wave.open(str(path),'wb') as w:
        w.setnchannels(2);w.setsampwidth(2);w.setframerate(sr)
        w.writeframes((stereo*26000).astype('<i2').tobytes())


def render(kind):
    slug='01-code-to-reviewed-pr' if kind==1 else '02-pick-up-your-work'
    with tempfile.TemporaryDirectory(prefix='gorkhali-render-') as tmp:
        sound=Path(tmp)/'sound.wav';soundtrack(sound,kind)
        cmd=['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-i',str(sound),'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p','-profile:v','high','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-c:a','aac','-b:a','128k','-ar','48000','-t','10','-movflags','+faststart',str(OUT/(slug+'.mp4'))]
        process=subprocess.Popen(cmd,stdin=subprocess.PIPE)
        try:
            for i in range(FPS*DURATION):
                process.stdin.write(frame(kind,i/FPS).tobytes())
        finally: process.stdin.close()
        if process.wait()!=0: raise RuntimeError('ffmpeg render failed')
    frame(kind,1.8).save(OUT/(slug+'-cover.jpg'),quality=95)
    samples=[.6,2.15,3.4,5.5,6.9,9.3]
    sheet=Image.new('RGB',(360*3,640*2))
    for j,t in enumerate(samples):
        cell=frame(kind,t).resize((360,640),Image.Resampling.LANCZOS)
        ImageDraw.Draw(cell).text((8,8),f'{t:.2f}s',font=font(18,False),fill='red',stroke_width=1,stroke_fill='white')
        sheet.paste(cell,((j%3)*360,(j//3)*640))
    sheet.save(Path('/tmp')/f'gorkhali-reel-{kind}-contact.jpg',quality=92)
    print(OUT/(slug+'.mp4'),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--stills-only',action='store_true')
    args=parser.parse_args()
    OUT.mkdir(parents=True,exist_ok=True)
    banner()
    if args.stills_only:
        for kind in (1,2):
            for t in (1.8,3.5,6.9,9.3):
                frame(kind,t).save(Path('/tmp')/f'gorkhali-{kind}-{t}.png')
    else:
        for kind in (1,2):render(kind)
