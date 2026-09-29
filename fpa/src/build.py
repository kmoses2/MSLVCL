import re
src=open("src.html",encoding="utf-8").read()
def lib(p):
    s=open(p,encoding="utf-8").read()
    s=s.replace("\ufffd","\\uFFFD")
    return re.sub(r"</(script)", r"<\\/\1", s, flags=re.I)
src=src.replace("/*__LIB_XLSX__*/",lib("xlsx-0.18.5/dist/xlsx.full.min.js"),1).replace("/*__LIB_EXCELJS__*/",lib("exceljs-4.4.0/dist/exceljs.min.js"),1)
open("/home/user/MSLVCL/fpa/BvA_원클릭.html","w",encoding="utf-8").write(src)
print(len(src.encode())/1e6,"MB")
