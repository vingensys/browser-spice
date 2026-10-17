<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE eagle SYSTEM "eagle.dtd">
<eagle version="9.6.2">
<drawing>
<settings><setting alwaysvectorfont="no"/></settings>
<grid distance="0.1" unitdist="inch" unit="inch" style="lines" multiple="1" display="no" altdistance="0.01" altunitdist="inch" altunit="inch"/>
<layers><layer number="1" name="Top" color="4" fill="1" visible="yes" active="yes"/></layers>
<schematic xreflabel="%F%N/%S.%C%R" xrefpart="/%S.%C%R">
<libraries>
<library name="rcl">
<symbols>
<symbol name="R-EU"><pin name="1" x="-5.08" y="0" visible="off" length="short" direction="pas" swaplevel="1"/><pin name="2" x="5.08" y="0" visible="off" length="short" direction="pas" swaplevel="1" rot="R180"/></symbol>
<symbol name="C-EU"><pin name="1" x="0" y="5.08" visible="off" length="short" direction="pas" swaplevel="1" rot="R270"/><pin name="2" x="0" y="-5.08" visible="off" length="short" direction="pas" swaplevel="1" rot="R90"/></symbol>
</symbols>
<devicesets>
<deviceset name="R-EU_" prefix="R" uservalue="yes"><gates><gate name="G$1" symbol="R-EU" x="0" y="0"/></gates><devices><device name="R0805" package="R0805"/></devices></deviceset>
<deviceset name="C-EU" prefix="C" uservalue="yes"><gates><gate name="G$1" symbol="C-EU" x="0" y="0"/></gates><devices><device name="C0805" package="C0805"/></devices></deviceset>
</devicesets>
</library>
<library name="diode">
<symbols><symbol name="D"><pin name="A" x="-2.54" y="0" visible="off" length="short" direction="pas"/><pin name="C" x="2.54" y="0" visible="off" length="short" direction="pas" rot="R180"/></symbol></symbols>
<devicesets><deviceset name="LED" prefix="LED"><gates><gate name="G$1" symbol="D" x="0" y="0"/></gates><devices><device name="" package="LED5MM"/></devices></deviceset>
<deviceset name="1N4148" prefix="D"><gates><gate name="G$1" symbol="D" x="0" y="0"/></gates><devices><device name="" package="DO35"/></devices></deviceset></devicesets>
</library>
<library name="transistor">
<symbols><symbol name="NPN"><pin name="B" x="-5.08" y="0" visible="off" length="short" direction="pas"/><pin name="C" x="2.54" y="5.08" visible="off" length="short" direction="pas" rot="R270"/><pin name="E" x="2.54" y="-5.08" visible="off" length="short" direction="pas" rot="R90"/></symbol></symbols>
<devicesets><deviceset name="BC547" prefix="T"><gates><gate name="G$1" symbol="NPN" x="0" y="0"/></gates><devices><device name="" package="TO92"/></devices></deviceset></devicesets>
</library>
<library name="supply1">
<symbols><symbol name="GND"><pin name="GND" x="0" y="0" visible="off" length="short" direction="sup" rot="R90"/></symbol><symbol name="+5V"><pin name="+5V" x="0" y="0" visible="off" length="short" direction="sup" rot="R270"/></symbol></symbols>
<devicesets><deviceset name="GND" prefix="GND"><gates><gate name="1" symbol="GND" x="0" y="0"/></gates><devices><device name=""/></devices></deviceset>
<deviceset name="+5V" prefix="P+"><gates><gate name="1" symbol="+5V" x="0" y="0"/></gates><devices><device name=""/></devices></deviceset></devicesets>
</library>
</libraries>
<attributes/><variantdefs/><classes><class number="0" name="default" width="0" drill="0"/></classes>
<parts>
<part name="R1" library="rcl" deviceset="R-EU_" device="R0805" value="10k"/>
<part name="R2" library="rcl" deviceset="R-EU_" device="R0805" value="4k7"/>
<part name="R3" library="rcl" deviceset="R-EU_" device="R0805" value="330"/>
<part name="C1" library="rcl" deviceset="C-EU" device="C0805" value="100nF"/>
<part name="D1" library="diode" deviceset="LED" device="" value="RED"/>
<part name="T1" library="transistor" deviceset="BC547" device="" value="2N3904"/>
<part name="GND1" library="supply1" deviceset="GND" device=""/>
<part name="GND2" library="supply1" deviceset="GND" device=""/>
<part name="P+1" library="supply1" deviceset="+5V" device=""/>
</parts>
<sheets>
<sheet>
<plain/>
<instances>
<instance part="R1" gate="G$1" x="30.48" y="50.8"/>
<instance part="R2" gate="G$1" x="30.48" y="30.48" rot="R90"/>
<instance part="R3" gate="G$1" x="76.2" y="60.96" rot="R90"/>
<instance part="C1" gate="G$1" x="45.72" y="25.4"/>
<instance part="D1" gate="G$1" x="76.2" y="45.72" rot="R270"/>
<instance part="T1" gate="G$1" x="60.96" y="35.56"/>
<instance part="GND1" gate="1" x="30.48" y="12.7"/>
<instance part="GND2" gate="1" x="63.5" y="12.7"/>
<instance part="P+1" gate="1" x="30.48" y="71.12"/>
</instances>
<busses/>
<nets>
<net name="+5V" class="0"><segment><pinref part="P+1" gate="1" pin="+5V"/><pinref part="R1" gate="G$1" pin="1"/><pinref part="R3" gate="G$1" pin="1"/><wire x1="30.48" y1="71.12" x2="30.48" y2="55.88" width="0.1524" layer="91"/></segment></net>
<net name="N$1" class="0"><segment><pinref part="R1" gate="G$1" pin="2"/><pinref part="R2" gate="G$1" pin="1"/><pinref part="C1" gate="G$1" pin="1"/><pinref part="T1" gate="G$1" pin="B"/><label x="40" y="50" size="1.778" layer="95" xref="no"/></segment></net>
<net name="N$2" class="0"><segment><pinref part="R3" gate="G$1" pin="2"/><pinref part="D1" gate="G$1" pin="A"/></segment></net>
<net name="N$3" class="0"><segment><pinref part="D1" gate="G$1" pin="C"/><pinref part="T1" gate="G$1" pin="C"/></segment></net>
<net name="GND" class="0"><segment><pinref part="GND1" gate="1" pin="GND"/><pinref part="R2" gate="G$1" pin="2"/><pinref part="C1" gate="G$1" pin="2"/></segment><segment><pinref part="GND2" gate="1" pin="GND"/><pinref part="T1" gate="G$1" pin="E"/></segment></net>
</nets>
</sheet>
</sheets>
</schematic>
</drawing>
</eagle>
