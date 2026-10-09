"""HEAD every object of each film's current version: object count and bytes per rendition -> storage, reads per full view, real average bitrate."""
import json, math, re, urllib.request, urllib.error, xml.etree.ElementTree as ET, csv
from concurrent.futures import ThreadPoolExecutor
B="https://ztor-video.mluthfi840.workers.dev"; UA="ztor-audit/1.0"; USER="audit-inv"
FILMS={"SPL2":("439662d9-e97b-44f5-9ae1-7bd346553e4b",5),"VULG4K":("ae60bf2f-5bd1-44cc-838b-d60e4594b98d",9),"X9":("becd8657-a8c0-4502-838d-527cb533d166",1)}
def req(method,url,body=None,headers=None):
    h={"User-Agent":UA}; h.update(headers or {}); data=json.dumps(body).encode() if body is not None else None
    if data: h["content-type"]="application/json"
    rq=urllib.request.Request(url,method=method,data=data,headers=h)
    try: r=urllib.request.urlopen(rq,timeout=60); return r.status,{k.lower():v for k,v in r.headers.items()},r.read()
    except urllib.error.HTTPError as e: return e.code,{k.lower():v for k,v in e.headers.items()},e.read()
out={}
rows=[]
for name,(fid,v) in FILMS.items():
    req("POST",f"{B}/test/rent",{"userId":USER,"filmId":fid,"hours":1})
    st,_,p=req("POST",f"{B}/play/{fid}",{"userId":USER,"deviceId":"inv","caps":{"hdcp":True}}); p=json.loads(p); tok=p["token"]
    st,_,mpd=req("GET",f"{B}/media/{fid}/v{v}/manifest.mpd",headers={"Authorization":"Bearer "+tok})
    ns={"m":"urn:mpeg:dash:schema:mpd:2011"}; root=ET.fromstring(mpd)
    dur=root.get("mediaPresentationDuration"); m=re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?([\d.]+)S",dur); secs=int(m.group(1) or 0)*3600+int(m.group(2) or 0)*60+float(m.group(3))
    reps=[]
    for aset in root.iter("{urn:mpeg:dash:schema:mpd:2011}AdaptationSet"):
        for rep in aset.findall("m:Representation",ns):
            stpl=rep.find("m:SegmentTemplate",ns) or aset.find("m:SegmentTemplate",ns)
            ts=int(stpl.get("timescale","1")); media=stpl.get("media"); init=stpl.get("initialization")
            tl=stpl.find("m:SegmentTimeline",ns)
            if tl is not None:
                n=0; 
                for s in tl.findall("m:S",ns): n+=1+int(s.get("r","0"))
            else: n=math.ceil(secs/(int(stpl.get("duration"))/ts))
            start=int(stpl.get("startNumber","1"))
            reps.append({"id":rep.get("id"),"height":rep.get("height") or aset.get("height"),"bw_attr":int(rep.get("bandwidth")),"codecs":rep.get("codecs") or aset.get("codecs"),"n":n,"start":start,"media":media,"init":init,"ctype":aset.get("contentType") or (aset.get("mimeType") or "")})
    # HEAD all
    def head(rel):
        st,h,_=req("HEAD",f"{B}/media/{fid}/v{v}/{rel}"); return rel,st,int(h.get("content-length") or 0),h.get("cache-control"),h.get("accept-ranges")
    todo=[]
    for r in reps:
        todo.append(r["init"].replace("$RepresentationID$",r["id"]))
        for k in range(r["start"],r["start"]+r["n"]): todo.append(r["media"].replace("$RepresentationID$",r["id"]).replace("$Number$",str(k)))
    manifests=["manifest.mpd","master.m3u8"]
    with ThreadPoolExecutor(16) as ex: res=list(ex.map(head,todo))
    bad=[x for x in res if x[1]!=200]
    per={}
    for rel,st,ln,cc,ar in res:
        rd=rel.split("/")[0]; per.setdefault(rd,{"objects":0,"bytes":0,"cc":set(),"ar":set()}); per[rd]["objects"]+=1; per[rd]["bytes"]+=ln; per[rd]["cc"].add(cc); per[rd]["ar"].add(ar)
    # manifests + media playlists (HLS): count them via master
    st,_,m3=req("GET",f"{B}/media/{fid}/v{v}/master.m3u8?t={tok}"); pls=re.findall(r'^(stream_\d+\.m3u8)',m3.decode(),re.M)+re.findall(r'URI="(stream_\d+\.m3u8)',m3.decode())
    pls=sorted(set(pls)); man_bytes=0
    for rel in ["manifest.mpd","master.m3u8"]+pls:
        st,h,b=req("GET",f"{B}/media/{fid}/v{v}/{rel}?t={tok}"); man_bytes+=len(b)
    tot_obj=sum(x["objects"] for x in per.values())+2+len(pls); tot_bytes=sum(x["bytes"] for x in per.values())+man_bytes
    heights={r["id"]:r["height"] for r in reps}
    print(f"\n== {name} v{v} duration={secs:.1f}s media objects={len(res)} non-200={len(bad)} manifests={2+len(pls)} TOTAL objects={tot_obj} bytes={tot_bytes/1e6:.1f} MB")
    for rd,x in sorted(per.items(),key=lambda kv:-kv[1]["bytes"]):
        mbps=x["bytes"]*8/secs/1e6; print(f"  {rd:<12} objects={x['objects']:>5} bytes={x['bytes']/1e6:>8.1f} MB  avg={mbps:6.2f} Mbps  cc={x['cc']} ar={x['ar']}")
        rows.append([name,v,rd,x["objects"],x["bytes"],round(mbps,3)])
    # per full view: 1080p view = video_1080p objs + audio objs + manifests(mpd or master+2 playlists); 2160p view similar
    a=per.get("audio",{"objects":0,"bytes":0})
    for hv in ("video_1080p","video_2160p"):
        if hv in per: print(f"  full view at {hv}: objects={per[hv]['objects']+a['objects']+1} bytes={(per[hv]['bytes']+a['bytes'])/1e6:.1f} MB -> per hour {(per[hv]['bytes']+a['bytes'])/secs*3600/1e9:.2f} GB, {(per[hv]['objects']+a['objects']+1)/secs*3600:.0f} requests")
    print(f"  stored per hour of film (all renditions): {tot_bytes/secs*3600/1e9:.2f} GB ; objects per hour: {tot_obj/secs*3600:.0f}")
    out[name]={"version":v,"duration_s":secs,"objects":tot_obj,"bytes":tot_bytes,"per_rendition":{k:{"objects":x["objects"],"bytes":x["bytes"]} for k,x in per.items()},"bad":bad[:5],"reps":reps}
    req("DELETE",f"{B}/test/rent",{"userId":USER,"filmId":fid})
json.dump(out,open("inventory.json","w"),indent=1); csv.writer(open("inventory.csv","w")).writerows([["film","version","rendition","objects","bytes","avg_mbps"]]+rows)
