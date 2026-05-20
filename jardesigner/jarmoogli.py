# This program interfaces to the jardesigner GUI for 3D rendering.
# Copyright (C) Upinder S. Bhalla NCBS 2025
# This program is licensed under the GNU Public License version 3.

from pathlib import Path
import numpy as np
import moose
import re
import requests
import json
import webbrowser
import pathlib
import os
import sys
import importlib.resources

# Define the URL for the internal server endpoint
FLASK_SERVER_URL = "http://127.0.0.1:5000/internal/push_data"

_INTERNAL_TOKEN = os.environ.get('JARDESIGNER_INTERNAL_TOKEN', '')

# Create a single session object for reuse; attach the internal auth header once.
http_session = requests.Session()
http_session.headers.update({'X-Internal-Token': _INTERNAL_TOKEN})

knownFieldInfo = {
    'Vm': {'fieldScale': 1000, 'dataUnits': 'mV', 
        'dataType': 'Memb. Potential', 'vmin':-80.0, 'vmax':40.0 },
    'initVm': {'fieldScale': 1000, 'dataUnits': 'mV', 
        'dataType': 'Initial Memb. Potential', 'vmin':-80.0, 'vmax':40.0 },
    'Im': {'fieldScale': 1e9, 'dataUnits': 'nA', 
        'dataType': 'Memb current', 'vmin':-10.0, 'vmax':10.0 },
    'inject': {'fieldScale': 1e9, 'dataUnits': 'nA', 
        'dataType': 'Injection current', 'vmin':-10.0, 'vmax':10.0 },
    'Gbar': {'fieldScale': 1e9, 'dataUnits': 'nS', 
        'dataType': 'Max chan conductance', 'vmin': 0.0, 'vmax':1.0 },
    'Gk': {'fieldScale': 1e9, 'dataUnits': 'nS', 
        'dataType': 'Chan conductance', 'vmin': 0.0, 'vmax':1.0 },
    'Ik': {'fieldScale': 1e9, 'dataUnits': 'nA', 
        'dataType': 'Chan current', 'vmin':-10.0, 'vmax':10.0 },
    'ICa': {'fieldScale': 1e9, 'dataUnits': 'nA', 
        'dataType': 'Ca current', 'vmin':-10.0, 'vmax':10.0 },
    'Ca': {'fieldScale': 1e3, 'dataUnits': 'uM', 
        'dataType': 'Ca conc', 'vmin':0.0, 'vmax':10.0 },
    'conc': {'fieldScale': 1e3, 'dataUnits': 'uM', 
        'dataType': 'Concentration', 'vmin':0.0, 'vmax':2.0 },
    'n': {'fieldScale': 1, 'dataUnits': '#', 
        'dataType': '# of molecules', 'vmin':0.0, 'vmax':200.0 },
    'volume': {'fieldScale': 1e18, 'dataUnits': 'um^3', 
        'dataType': 'Volume', 'vmin':0.0, 'vmax':1000.0 },
    'other': {'fieldScale': 1, 'dataUnits': '#', 
        'dataType': 'plot', 'vmin':0.0, 'vmax':1.0 },
}

unitX = np.array( [1.0, 0.0, 0.0] )
unitY = np.array( [0.0, 1.0, 0.0] )
unitZ = np.array( [0.0, 0.0, 1.0] )
DefaultDiaScale = 2.0

def objPath( obj, splitLevel ):
    split = obj.path.split('/')
    if splitLevel == 1:
        ret = split[-1]
    elif splitLevel == 2:
        if len( split ) >= 2:
            ret = f"{split[-2]}/{split[-1]}"
        else:
            return objPath( obj, 1 )
    elif splitLevel == 3:
        if len( split ) >= 3:
            ret = f"{split[-3]}/{split[-2]}/{split[-1]}"
        else:
            return objPath( obj, 2 )

    if obj.dataIndex > 0 and ret[-1] != ']':
        return f"{ret}[{obj.dataIndex}]"
    elif obj.dataIndex == 0 and ret[-1] == ']':
        idx = ret.rfind( '[' )
        return ret[:idx]
    else:
        return ret

def getObjListInfo( objList ):
    ''' Returns a list of paths and a list of [x,y,z,dia] of the centers 
    of each object in the objList '''

    if len( objList ) == 0:
        return [], []
    elm = objList[0]
    if elm.isA["PoolBase"]:
        meshType = elm.parent.className
        paths = [objPath( ee, 3 ) for ee in objList ]
        coords = [ ee.coords for ee in objList ]
        if meshType == "NeuroMesh":
            for cc in coords:
                cc[6] *= 2
        elif meshType == "PsdMesh":
            for cc in coords:
                cc[3:6] += cc[0:3]
        elif meshType == "SpineMesh":
            for cc in coords:
                cc[6] = cc[9]   # For diameter
        elif meshType == "PresynMesh":
            for cc in coords:
                cc[3:6] = cc[3:6]*cc[6] + cc[0:3]   
        elif meshType == "EndoMesh":
            newcoords = []
            for cc in coords:
                ncc = np.zeros( 7 )
                ncc[0:3] = cc[0:3]
                ncc[3:6] = cc[0:3]   # This may cause problems finding axis
                ncc[6] = cc[3] 
                newcoords.append( ncc )
                coords = newcoords
    elif elm.isA["CompartmentBase"]:
        paths = [objPath( ee, 1 ) for ee in objList ]
        coords = [ ee.coords for ee in objList ]
    elif elm.isA["ChanBase"] or elm.isA["CaConcBase"]:
        paths = [objPath( ee, 2 ) for ee in objList ]
        coords = [ ee.parent.coords  for ee in objList ]
    elif elm.isA["VClamp"]:
        paths = [objPath( ee.parent, 1 ) for ee in objList ]
        coords = [ ee.parent.coords  for ee in objList ]
    else:
        return [], []

    return paths, coords
    
class Segment():
    def __init__( self, shape, coords, simId, simPath, swcType, idx, value = 0 ):
        self.shape = shape
        self.C = list(coords[0:3])
        self.C2 = list(coords[3:6])
        self.diameter = coords[6]
        self.simId = simId
        self.simPath = simPath
        self.swcType = swcType
        self.shapeIdx = idx
        self.value = value

    def toDict( self ):
        return {
            "type": self.shape,
            "C": self.C,
            "C2": self.C2,
            "diameter": self.diameter,
            "value": self.value,
            "swcType": self.swcType,
            "shapeIdx": self.shapeIdx,
            "simId": self.simId,
            "simPath": self.simPath
        }
    
    @staticmethod
    def trimComptPath( path ):
        return Path( path ).name

    @staticmethod
    def trimMolPath( mol, dendName = "" ):
        p = Path( mol.path )
        intermediates = p.parts[4:-1]
        intermediatesPath = "/".join(intermediates)
        myName = p.parts[-1]
        chemComptName = p.parts[3] # Assumes /model/chem precede it.
        if chemComptName[-3:] == "[0]":
            chemComptName = chemComptName[:-3]
        if len( intermediatesPath ) > 0:
            ret = f"{dendName}/{chemComptName}/{intermediatesPath}/{myName}[{mol.dataIndex}]"
        else:
            ret = f"{dendName}/{chemComptName}/{myName}[{mol.dataIndex}]"
        #print( ret )
        return ret
    
    @staticmethod
    def simpleCompt( compt, idx ):
        if compt.name == "soma":
            newc = np.array( compt.coords )
            newc[0:3] = (newc[0:3] + newc[3:6])/2
            return Segment( "sphere", newc, compt.id.idValue, 
                Segment.trimComptPath( compt.path ), 1, idx, value = -0.1 )
        else:
            return Segment( "cylinder", compt.coords, compt.id.idValue, 
                Segment.trimComptPath( compt.path ), 4, idx, value = -0.1 )

    # === NEW: Method to represent IntFire objects as spheres ===
    @staticmethod
    def intFireCompt( compt, coords, idx ):
        # Use the provided coordinates, assume a default diameter.
        # Coords format: [x, y, z, x, y, z, diameter]
        new_coords = np.zeros(7)
        new_coords[0:3] = coords[0:3]
        new_coords[3:6] = coords[0:3] # Sphere C2 is same as C
        new_coords[6] = 10e-6 # Default diameter of 10 microns
        return Segment("sphere", new_coords, compt.id.idValue,
                Segment.trimComptPath(compt.path), 1, idx)

    @staticmethod
    def cylChemCompt( mol, idx ):
        parentDendName = mol.parent.subTree[0].name
        ret =  Segment( "cylinder", mol.coords, mol.id.idValue, 
            Segment.trimMolPath( mol, parentDendName ), 0, idx, value = -0.04 )
        ret.diameter *= 2           # Moose puts radius in coords[6]
        return ret

    def psdChemCompt( mol, idx ):
        newc = np.array(mol.coords[:7])
        newc[3:6] += newc[0:3]
        # Diameter is in newc[6]
        ret =  Segment( "cylinder", newc, mol.id.idValue, 
            Segment.trimMolPath( mol ), 0, idx )
        #print( f"IN PSD_CHEMCOMPT dia = {ret.diameter}, molcoords = {newc}" )
        return ret

    @staticmethod
    def spineChemCompt( mol, idx ):
        newc = np.array(mol.coords[:7])
        newc[6] = mol.coords[9]   # For diameter
        #print( f"IN SPINE_CHEMCOMPT dia = {newc[6]}, molcoords = {mol.coords}" )
        return Segment( "cylinder", newc, mol.id.idValue, 
            Segment.trimMolPath( mol ), 0, idx )

    @staticmethod
    def presynChemCompt( mol, idx ):
        newc = np.array(mol.coords[:7])
        # Unit vector of cone direction is in coords[3:6], dia in coords[6]
        newc[3:6] = -newc[3:6]*newc[6] + newc[0:3]   
        return Segment( "cone", newc, mol.id.idValue, 
            Segment.trimMolPath( mol ), 0, idx )

    @staticmethod
    def endoChemCompt( mol, idx ):
        newc = np.zeros( 7 )
        newc[0:3] = mol.coords[0:3]
        newc[3:6] = newc[0:3]
        newc[6] = mol.coords[3] 
        return Segment( "sphere", newc, mol.id.idValue, 
            Segment.trimMolPath( mol ), 5, idx )

    @staticmethod
    def chanBase( icon, path, newc, simId, idx, iconNum, value ):
        theta = idx * 0.1 + iconNum * np.pi * 2 / 8
        axis = np.array( newc[0:3] - newc[3:6] )
        axLen = Segment.normToCylAxis( newc, theta, path=="soma" )
        # Position channels along the length of the axis to reduce clutter
        newc[0:3] = newc[0:3] - axis/2 + axis*(2+iconNum)*0.05 + newc[3:6] * newc[6] * 0.5 * DefaultDiaScale
        newc[6] = max( 2e-6, newc[6] * DefaultDiaScale * 0.2 )
        return Segment( icon, newc, simId, path, 0, idx, value = value )

    @staticmethod
    def normToCylAxis( newc, theta, isSoma ):
        # This places a unit vector normal to the cyl axis in newc[3:6]
        # It replaces newc[0:3] with the middle of the cyl or soma.
        dx = np.cos( theta )
        dy = np.sin( theta )
        axisLength = np.linalg.norm(newc[3:6]-newc[0:3])
        if isSoma or axisLength < 1e-9:
            newc[0:3] = (newc[0:3]+newc[3:6])/2
            newc[3] = 0
            newc[4] = dx
            newc[5] = dy
            return newc[6]
        else:
            axis = (newc[3:6]-newc[0:3])/axisLength
            if abs(np.dot( axis, unitX )) < 0.99:
                perp = np.cross( axis, unitX )
                perp2 = np.cross( axis, perp )
            elif abs(np.dot( axis, unitY )) < 0.99:
                perp = np.cross( axis, unitY )
                perp2 = np.cross( axis, perp )
            else:
                perp = np.cross( axis, unitZ )
                perp2 = np.cross( axis, perp )
            perp = perp/np.linalg.norm( perp )
            perp2 = perp2/np.linalg.norm( perp2 )
            newc[0:3] = (newc[3:6] + newc[0:3])/2
            newc[3:6] = perp*dx + perp2*dy
            return axisLength

    @staticmethod
    def chanx( path, newc, simId, idx, iconNum ):
        return Segment.chanBase( f"chan{iconNum%4}", path, newc, simId, 
            idx, iconNum, -0.1 + iconNum*0.02)

    @staticmethod
    def plotTrodeOrAdaptor( path, newc, simId, idx, theta, shape ):
        # dia in coords[6]
        # cone is 4 microns and is aligned radially away from center
        # of cylinder/sphere, which it touches at its surface.
        axLen = Segment.normToCylAxis( newc, theta, path == "soma")
        start = np.array(newc[0:3]) # Middle of compartment.
        axis = np.array(newc[3:6]) #unit vector of cone direction.
        trodeLen = max(4e-6, np.sqrt( axLen * newc[6] )*DefaultDiaScale)/2
        # This is the sharp end, end touching the compartment
        newc[3:6] = start + axis * newc[6] * 0.55 * DefaultDiaScale
        newc[0:3] = newc[3:6] + axis * trodeLen # This is the fat end
        #newc[3:6] = start
        #newc[0:3] = start + axis * trodeLen # This is the fat end

        newc[6] = trodeLen / 6
        return Segment( shape, newc, simId, path, 0, idx, value = -0.01 )

    @staticmethod
    def plotTrode( path, newc, simId, idx, iconNum ):
        theta = idx*0.1 + iconNum*np.pi/8
        return Segment.plotTrodeOrAdaptor( path, newc, simId, idx, theta, "cone" )

    @staticmethod
    def adaptor( path, newc, simId, idx, iconNum ):
        theta = idx*1.7 + iconNum*np.pi/8
        return Segment.plotTrodeOrAdaptor( path, newc, simId, idx, theta, "adaptor" )

    @staticmethod
    def stimTrode( objType, path, newc, simId, idx, iconNum ):
        # I now have a lathe-shape for the stim. dia in coords[6]
        theta = idx*0.1 + np.pi/2 + iconNum*np.pi/8
        axLen = Segment.normToCylAxis( newc, theta, path == "soma")
        start = np.array(newc[0:3]) # Middle of compartment.
        axis = np.array(newc[3:6]) #unit vector of cone direction.
        trodeLen = max( 4e-6, np.sqrt( axLen * newc[6] )*DefaultDiaScale )
        # This is the sharp end, end touching the compartment
        newc[0:3] = start + axis * newc[6] * 0.55 * DefaultDiaScale
        #newc[0:3] = start
        newc[3:6] = axis
        newc[6] = trodeLen/3
        return Segment( objType, newc, simId, path, 0, idx, value = 0.02 )

    @staticmethod
    def moogTrode( path, newc, simId, idx, iconNum ):
        # square: C is centre, C2 is normal.
        # If diameter is smaller than segment length, then smaller of
        #   (Segmentlength, 5 microns.)
        # If diameter is > segment length, then go with segment length.
        # It touches cylinder at its surface.
        # IF on a sphere, place the normal on the x axis.
        theta = idx*0.1 + 3*np.pi/2 + iconNum*np.pi/8
        axisLength = np.linalg.norm(newc[3:6]-newc[0:3])
        if axisLength == 0:
            comptAxis = np.array( newc[0:3] )
        else:
            comptAxis = np.array( newc[0:3] - newc[3:6] )
        axLen = Segment.normToCylAxis( newc, theta, path == "soma")
        start = np.array(newc[0:3] + comptAxis * 0.25 )
        planeNormal = np.cross( newc[3:6], comptAxis )
        newc[0:3] = start + newc[3:6]*newc[6]*DefaultDiaScale
        newc[3:6] = planeNormal / np.linalg.norm( planeNormal )
        newc[6] = newc[6]*DefaultDiaScale * 1.2

        '''
        theta = np.pi * 5/2
        vec = newc[0:3] - newc[3:6]
        segmentLength = np.sqrt( np.sum( vec*vec) )
        if newc[6] < segmentLength:
            side = min( segmentLength, 5e-6)
        else:
            side = segmentLength
        dx = np.cos( theta + idx * 0.1 )
        dy = np.sin( theta + idx * 0.1 )
        if path == "soma":
            newc[0:3] = newc[3:6]
        else:
            newc[3:6] = (newc[3:6] + newc[0:3])/2
            newc[0:3] = newc[3:6]
        newc[4] = dy    # Normal parallel to axis
        newc[5] = -dx   # Normal parallel to axis
        newc[1] += side*dx * 0.55 # Just a small offset from the surface.
        newc[2] += side*dy * 0.55 # Just a small offset from the surface.
        '''
        return Segment( "moogli", newc, simId, path, 0, idx, value = 0.05 )

def extractUnits( text ):
    match = re.search(r'\((.*?)\)', text)
    if match:
        return match.group(1)
    return "Numbers"

class DataWrapper:
    def __init__( self, fdict, groupId ):
        self.title = fdict['title']
        self.groupId = groupId
        #self.path = fdict['path']
        self.field = fdict['field']
        self.relObjPath_ = fdict['relpath']
        fieldInfo = knownFieldInfo[self.field]
        self.dataType = fieldInfo['dataType']
        self.fieldScale_ = fieldInfo['fieldScale']
        self.dataUnits = fieldInfo['dataUnits']
        default_vmin = fieldInfo['vmin']
        default_vmax = fieldInfo['vmax']

        if fdict.get('vmin') is not None and fdict.get('vmax') is not None and fdict['vmin'] != fdict['vmax']:
            self.vmin = fdict['vmin']
            self.vmax = fdict['vmax']
        else:
            self.vmin = default_vmin
            self.vmax = default_vmax
            
        self.diaScale = fdict.get('diaScale', 1.0)
        self.transparency = fdict.get('transparency', 0.5)
        self.dt = fdict.get('dt', 0.001)
        self.visible = fdict.get('visible', True)
        self.objList_ = []
        self.segmentList = []

    def toDict( self ):
        return {
            "title": self.title,
            "groupId": self.groupId,
            "dataType": self.dataType,
            "dataUnits": self.dataUnits,
            "vmin": self.vmin,
            "vmax": self.vmax,
            "dt": self.dt,
            "transparency": self.transparency,
            "diaScale": self.diaScale,
            "visible": self.visible,
            "shape": [ ss.toDict() for ss in self.segmentList ]
        }

    def getDataFrame( self, timestamp ):
        raise NotImplementedError

class MooseNeuronDataWrapper( DataWrapper ):
    def __init__( self, compts, fdict, groupId ): 
        fdict['transparency'] = fdict.get('transparency', 0.5)
        super().__init__(fdict, groupId )
        #self.neuronId_ = neuronId
        self.dummyObj = None
        if self.field == "Ca":
            self.dummyObj = moose.CaConc( "/dummyCa" )
        elif self.field in ["Ik","Gk", "Ek", "Gbar", "modulation"]:
            self.dummyObj = moose.SynChan( "/dummySynChan" )

        # === RESTORED: Logic to handle both Compartment and IntFire types ===
        #compts = moose.wildcardFind( neuronId.path + "/#[ISA=CompartmentBase]" )
        # Need a cleaner check for IntFires.
        if len(compts) > 0:
            self.segmentList = [ Segment.simpleCompt( cc, idx ) for idx, cc in enumerate( compts ) ]
        else:
            #compts = moose.wildcardFind( neuronId.path + "/#[ISA=IntFire]" )
            if len(compts) > 0:
                # For IntFire, we need to fetch coordinates separately.
                coords_vec = moose.vec( compts[0].path + "/coords" )
                coords_list = [coords_vec[i] for i in range(len(coords_vec))]
                self.segmentList = [ Segment.intFireCompt(cc, cd, idx) for idx, (cc, cd) in enumerate(zip(compts, coords_list)) ]
            else:
                print("Error: MooseNeuronDataWrapper found neither CompartmentBase nor IntFire objects.")
        
        if self.relObjPath_ == ".":
            self.objList_ = compts
        else:
            self.objList_ = []
            for i in compts:
                path_to_check = i.path + '/' + self.relObjPath_
                if moose.exists( path_to_check ):
                    self.objList_.append(moose.element(path_to_check))
                elif self.dummyObj:
                    self.objList_.append(self.dummyObj)

    def getDataFrame( self, timestamp ):
        fs = self.fieldScale_
        values = [fs*float(moose.getField(i, self.field)) for i in self.objList_]
        return {
            "filetype": "jardesignerDataFrame",
            "version": "1.0",
            "viewId": "run",
            "timestamp": float(timestamp),
            "groupId": self.groupId,
            "data": values
        }

class MooseChemDataWrapper( DataWrapper ):
    def __init__( self, objList, fdict, groupId ):
        fdict['transparency'] = fdict.get('transparency', 0.8)
        super().__init__(fdict, groupId )
        self.objList_ = objList
        if not objList:
            return
        
        meshType = objList[0].parent.className
        if meshType in ["NeuroMesh", "CylMesh"]:
            self.segmentList = [ Segment.cylChemCompt( cc, idx ) for idx, cc in enumerate( objList ) ]
        elif meshType == "PsdMesh":
            self.segmentList = [ Segment.psdChemCompt( cc, idx ) for idx, cc in enumerate( objList ) ]
        elif meshType == "SpineMesh":
            self.segmentList = [ Segment.spineChemCompt( cc, idx ) for idx, cc in enumerate( objList ) ]
        elif meshType == "PresynMesh":
            self.segmentList = [ Segment.presynChemCompt( cc, idx ) for idx, cc in enumerate( objList ) ]
        elif meshType == "EndoMesh":
            self.segmentList = [ Segment.endoChemCompt( cc, idx ) for idx, cc in enumerate( objList ) ]

    def getDataFrame( self, timestamp ):
        values = [float(moose.getField(i, self.field)) for i in self.objList_]
        return {
            "filetype": "jardesignerDataFrame",
            "version": "1.0",
            "viewId": "run",
            "timestamp": float(timestamp),
            "groupId": self.groupId,
            "data": values
        }

class MooseTrodeDataWrapper( DataWrapper ):
    def __init__( self, objList, fdict, groupId ):
        fdict['transparency'] = 1
        fdict['diaScale'] = 2.5
        super().__init__(fdict, groupId )
        self.objList_ = objList
        if not objList:
            return
        
        objType = fdict['dataType']
        iconNum = fdict['iconNum']
        paths, coords = getObjListInfo( objList )
        #print( f"mooseTrodeDataWrapper: objList = {len( objList)}, class = {objList[0].className}" )
        #print( f"mooseTrodeDataWrapper: paths = {len( paths)}, coords = {len(coords )}" )
        #print( f"mooseTrodeDataWrapper: isa = {objList[0].isA['HHChannelBase']}, isachanbase = {objList[0].isA['ChanBase']}" )
        if objType == "plot":
            #print( f"SETUP PLOT: objList[0] = {objList[0].path}, {objList[0].className}, \n FDICT = {fdict}" )
            paths = [ "plot_"+pp for pp in paths]
            self.segmentList = [ Segment.plotTrode( pp, cc, obj.id.idValue, idx, iconNum ) for idx, (pp, cc, obj ) in enumerate( zip( paths, coords, objList) ) ]
        elif objType in ["stim", "vclamp"]:
            paths = [ objType+"_"+pp for pp in paths]
            self.segmentList = [ Segment.stimTrode( objType, pp, cc, obj.id.idValue, idx, iconNum ) for idx, (pp, cc, obj ) in enumerate( zip( paths, coords, objList) ) ]
        elif objType == "moogli":
            paths = [ "moogli_"+pp for pp in paths]
            self.segmentList = [ Segment.moogTrode( pp, cc, obj.id.idValue, idx, iconNum ) for idx, (pp, cc, obj ) in enumerate( zip( paths, coords, objList) ) ]
        elif objType == "chan":
            frel = fdict['relpath']
            if len(frel) > 0 and frel != ".":
                paths = [ pp+"/"+frel for pp in paths]
            self.segmentList = [ Segment.chanx( pp, cc, obj.id.idValue, idx, iconNum ) for idx, (pp, cc, obj ) in enumerate( zip( paths, coords, objList) ) ]
        elif objType == "adaptor":
            frel = fdict['relpath']
            if len(frel) > 0 and frel != ".":
                paths = [ pp+"/"+frel for pp in paths]
            self.segmentList = [ Segment.adaptor( pp, cc, obj.id.idValue, idx, iconNum ) for idx, (pp, cc, obj ) in enumerate( zip( paths, coords, objList) ) ]
        '''
        '''

    def getDataFrame( self, timestamp ): # Dummy function, returns zeros.
        return {
            "filetype": "jardesignerDataFrame",
            "version": "1.0",
            "timestamp": float(timestamp),
            "groupId": self.groupId,
            "data": [0]* len( self.objList_ )
        }

class MooView:
    def __init__( self, dataChannelId, displayConfig = None ):
        self.drawables = []
        self.dataChannelId = dataChannelId
        self.standalone = ( dataChannelId == None )
        self.standaloneFrames = []
        self._pendingFrames = []
        self.standaloneSceneGraph = None
        if displayConfig:
            self.displayConfig = displayConfig
        else:
            self.displayConfig = {
                "filetype": "jardesignerSceneGraph",
                "version": "1.0",
                "wallClockDt": 1000,
                "runtime": 0.01,
                "rotation": 0.0,
                "azim": 0,
                "elev": 0,
                "mergeDisplays": True,
                "colormap": "jet",
                "bg": "white",
                "block": True,
                "fullscreen": False,
                "center": [0,0,0]
            }

    def getSceneGraph(self):
        return {
            **self.displayConfig,
            "drawables": [d.toDict() for d in self.drawables]
        }
        
    def updateValues( self, simTime, idx ):
        if idx >= len(self.drawables):
            return

        payload = self.drawables[idx].getDataFrame( simTime )
        if self.standalone:
            self.standaloneFrames.append( payload )
        else:
            self._pendingFrames.append( payload )


    def makeMoogli(self, mooObj, fdict, groupId ):
        mooField = fdict.get('field', 'Vm')
        #print( f"IN MAKE MOOGLI, moofield = {mooObj[0].path}.{mooField}" )
        if mooField in ['n', 'conc']: # mooObj is the wildcard list
            dw = MooseChemDataWrapper(mooObj, fdict, groupId)
        elif mooField == 'other': # mooObj is objList
            dw = MooseTrodeDataWrapper(mooObj, fdict, groupId)
        else:
            dw = MooseNeuronDataWrapper(mooObj, fdict, groupId)
        self.drawables.append(dw)

    def updateMoogliViewer( self, idx ):
        if idx >= len(self.drawables):
            return
        simTime = moose.element( '/clock' ).currentTime
        #print( "called updateMoogliViewer for {} at {:.3f}".format( idx, simTime ) )
        self.updateValues( simTime, idx )

    def sendSceneGraph( self, viewId, meshMols = "", reacGraph = None ):
        payload = {
            "type": "scene_init",
            "viewId": viewId,
            "scene": self.getSceneGraph(),
            "reactionGraph": reacGraph,
            "meshMols": meshMols
        }
        requestBody = {
            "data_channel_id": self.dataChannelId,
            "payload": payload
        }
        if self.standalone:
            self.standaloneSceneGraph = payload['scene']
        else:
            try:
                requests.post(FLASK_SERVER_URL, json=requestBody,
                              headers={'X-Internal-Token': _INTERNAL_TOKEN}, timeout=2.0)
                #print( "Sent Scene Graph: \n", requestBody )
            except Exception as e:
                print(f"FATAL ERROR: Could not send initial scene graph to server. {e}")
    

    def notifySimulationEnd( self, dataChannelId ):
        """
        Sends a final message to the client to signal that the simulation
        has completed.
        """
        if self.standalone:
            self.generateStandaloneHtml()
            return
        if self._pendingFrames:
            try:
                requests.post(FLASK_SERVER_URL,
                              json={"data_channel_id": dataChannelId,
                                    "payload": {"type": "sim_batch",
                                                "frames": self._pendingFrames}},
                              headers={'X-Internal-Token': _INTERNAL_TOKEN},
                              timeout=30.0)
            except Exception as e:
                print(f"Warning: Could not send simulation frame batch. {e}")
            self._pendingFrames = []
        try:
            requests.post(FLASK_SERVER_URL,
                          json={"data_channel_id": dataChannelId,
                                "payload": {"type": "sim_end",
                                            "message": "Simulation has finished."}},
                          headers={'X-Internal-Token': _INTERNAL_TOKEN},
                          timeout=2.0)
            print("Sent simulation end notification.")
        except Exception as e:
            print(f"Warning: Could not send simulation end notification. {e}")






    def generateStandaloneHtml(self, 
            templatePath ="jardes3Dtemplate.html", 
            outputPath = "jardes3Doutput.html"):
        """
        Generates a single, self-contained HTML file with embedded simulation data.

        Args:
            templatePath (str): The filename of the HTML template, assumed to be
                                in the same directory as the script.
            outputPath (str): The filename for the output HTML, which will be saved
                              in the current working directory.
        """
        try:
            absoluteOutputPath = os.path.join(os.getcwd(), outputPath)

            # 1. Read the HTML template file
            templateContent = importlib.resources.read_text('jardesigner', 'jardes3Dtemplate.html')
            '''
            scriptDir = os.path.dirname(os.path.realpath(sys.argv[0]))
            absoluteTemplatePath = os.path.join(scriptDir, templatePath)

            # Resolve the output path relative to the current working directory
            absoluteOutputPath = os.path.join(os.getcwd(), outputPath)

            # 1. Read the HTML template file
            with open(absoluteTemplatePath, 'r') as f:
                templateContent = f.read()
            '''

            # 2. Serialize the collected data into JSON strings
            sceneGraphJson = json.dumps(self.standaloneSceneGraph)
            framesJson = json.dumps(self.standaloneFrames)

            # 3. Inject the data by replacing placeholders in the template
            # NOTE: The placeholders in your template should now match exactly,
            # including the single quotes.
            content = templateContent.replace(
                "'__PLACEHOLDER_FOR_SCENE_CONFIG__'", sceneGraphJson
            )
            content = content.replace(
                "'__PLACEHOLDER_FOR_SIMULATION_FRAMES__'", framesJson
            )

            # 4. Save the new, data-filled HTML file
            with open(absoluteOutputPath, 'w') as f:
                f.write(content)

            print(f"Generated standalone view at: {absoluteOutputPath}")

            # 5. Open the generated file in the default web browser
            fileUrl = pathlib.Path(absoluteOutputPath).resolve().as_uri()
            print("Opening view in default web browser...")
            webbrowser.open(fileUrl)

        except FileNotFoundError:
            print(f"FATAL ERROR: HTML template not found at '{absoluteTemplatePath}'")
        except Exception as e:
            print(f"An unexpected error occurred: {e}")
