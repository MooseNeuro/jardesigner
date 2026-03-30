# -*- coding: utf-8 -*-
#########################################################################
## jarrdesigner.py ---
## This program is part of 'MOOSE', the
## Messaging Object Oriented Simulation Environment.
##           Copyright (C) 2014 Upinder S. Bhalla. and NCBS
## It is made available under the terms of the
## GNU General Public License version 3 or later.
## See the file COPYING.LIB for the full notice.
#########################################################################

##########################################################################
## This class builds models of
## Reaction-Diffusion and Electrical SIGnaling in NEURons.
## It loads in neuronal and chemical signaling models and embeds the
## latter in the former, including mapping entities like calcium and
## channel conductances, between them.
##########################################################################
import json
import jsonschema
import importlib.util
import os
import moose
import numpy as np
import math
import sys
import time
import threading
import matplotlib.pyplot as plt
import argparse
import requests
import csv
import traceback
from . import jarmoogli
from . import jardesignerProtos as jp
from . import jarReacGraph as jrg
from . import fixXreacs

from moose.neuroml.NeuroML import NeuroML
from moose.neuroml.ChannelML import ChannelML
from . import context

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
        'dataType': 'Volume', 'vmin':0.0, 'vmax':1000.0 }
}

DefaultFdict = { "title": "Elec compartments", 
    "field": "Vm",
    "relpath": ".",
    "dataType": "voltage",
    "dataUnits": "mV",
    "vmin": -0.1,
    "vmax": 0.05,
    "iconNum": 0 
}

class AnimationEvent():
    def __init__(self, key, time):
        self.key = key
        self.time = time

class DictToClass:
    def __init__(self, input_dict):
        for key, value in input_dict.items():
            setattr(self, key, value)

# In python3, cElementTree is deprecated. We do not plan to support python <2.7
# in future, so other imports have been removed.
try:
  from lxml import etree
except ImportError:
  import xml.etree.ElementTree as etree

meshOrder = ['soma', 'dend', 'spine', 'psd', 'psd_dend', 'presyn_dend', 'presyn_spine', 'endo']

# Deprecated. Use knownFieldInfo which is a dict defined above.
knownFieldsDefault = {
    'Vm':('CompartmentBase', 'getVm', 1000, 'Memb. Potential (mV)', -80.0, 40.0 ),
    'initVm':('CompartmentBase', 'getInitVm', 1000, 'Init. Memb. Potl (mV)', -80.0, 40.0 ),
    'Im':('CompartmentBase', 'getIm', 1e9, 'Memb. current (nA)', -10.0, 10.0 ),
    'inject':('CompartmentBase', 'getInject', 1e9, 'inject current (nA)', -10.0, 10.0 ),
    'Gbar':('ChanBase', 'getGbar', 1e9, 'chan max conductance (nS)', 0.0, 1.0 ),
    'Gk':('ChanBase', 'getGk', 1e9, 'chan conductance (nS)', 0.0, 1.0 ),
    'Ik':('ChanBase', 'getIk', 1e9, 'chan current (nA)', -10.0, 10.0 ),
    'ICa':('NMDAChan', 'getICa', 1e9, 'Ca current (nA)', -10.0, 10.0 ),
    'Ca':('CaConcBase', 'getCa', 1e3, 'Ca conc (uM)', 0.0, 10.0 ),
    'n':('PoolBase', 'getN', 1, '# of molecules', 0.0, 200.0 ),
    'conc':('PoolBase', 'getConc', 1000, 'Concentration (uM)', 0.0, 2.0 ),
    'volume':('PoolBase', 'getVolume', 1e18, 'Volume (um^3)' )
}

def _profile(func):
    """
    Can be used to profile a function. Useful in debugging and profiling.
    Author: Dilawar Singh
    """
    def wrap(self=None, *args, **kwargs):
        t0 = time.time()
        result = func(self, *args, **kwargs)
        print("[INFO ] Took %s sec" % (time.time()-t0))
        return result
    return wrap
        

class BuildError(Exception):
    def __init__(self, value):
        self.value = value
    def __str__(self):
        return repr(self.value)

#######################################################################
## Functions for managing the json dicts.
#######################################################################

def addDefaultsRecursive(instance, schema):
    """
    Recursively adds default values from a JSON schema to a JSON instance.
    Handles nested objects, arrays, and oneOf keywords.
    """
    if isinstance(schema, dict) and isinstance(instance, dict):
        if 'oneOf' in schema:
            for subschema in schema['oneOf']:
                try:
                    # Check which subschema matches
                    jsonschema.validate(instance, subschema)  
                    # Apply defaults from that subschema
                    return addDefaultsRecursive(instance, subschema)  
                except:
                    pass  # If validation fails, try the next subschema
        else:
            for prop, prop_schema in schema.get('properties', {}).items():
                if 'default' in prop_schema and prop not in instance:
                    instance[prop] = prop_schema['default']
                elif prop in instance and isinstance(prop_schema, dict):
                    instance[prop] = addDefaultsRecursive(instance[prop], prop_schema)
                elif 'oneof' in prop_schema and prop not in instance:
                    for sch in prop_schema['oneof']:
                        if 'default' in sch:
                            instance[prop] = sch['default']
                            break
                else:
                    pass


    elif isinstance(schema, dict) and 'items' in schema and isinstance(instance, list):
        item_schema = schema['items']
        for i, item in enumerate(instance):
            instance[i] = addDefaultsRecursive(item, item_schema)

    return instance


def applyModifiers(sourceDict: dict, modifierDict: dict) -> None:
    """
    Applies modifications from a sparse modifier dict to a source dict 
    in-place. This function modifies the source dictionary directly based 
    on a modifier dictionary, following specific rules for different 
    types of keys (Protos, Distribs, and top-level properties).

    Args:
        sourceDict: The original dictionary to be modified in-place.
        modifierDict: A sparse dictionary containing the changes.
    """
    # Define the unique lookup keys for different 'Distrib' lists
    distribLookupKeys = {
        'passiveDistrib': ['path'],
        'spineDistrib': ['proto', 'path'],
        'chanDistrib': ['proto', 'path'],
        'chemDistrib': ['proto', 'path']
    }

    for key, modValue in modifierDict.items():
        # --- Handle Protos (e.g., 'chanProto', 'spineProto') ---
        if key.endswith('Proto') and isinstance(modValue, list):
            sourceList = sourceDict.get(key, [])
            for modItem in modValue:
                modName = modItem.get('name')
                if not modName:
                    continue  # Skip if the modifier item lacks a name for lookup

                # Find the matching item in the source list by 'name'
                for sourceItem in sourceList:
                    if sourceItem.get('name') == modName:
                        if 'source' in modItem:
                            sourceItem['source'] = modItem['source']
                        break # Found and updated, move to the next modItem

        # --- Handle Distribs (e.g., 'chanDistrib', 'passiveDistrib') ---
        elif key.endswith('Distrib') and isinstance(modValue, list):
            sourceList = sourceDict.get(key, [])
            lookupFields = distribLookupKeys.get(key)
            if not lookupFields:
                continue # Skip if we don't know how to look this up

            for modItem in modValue:
                # Find the matching item in the source list using the 
                # defined lookup keys
                for sourceItem in sourceList:
                    if all(sourceItem.get(field) == modItem.get(field) for field in lookupFields):
                        # Found a match, update it from the modifier item
                        sourceItem.update(modItem)
                        break # Found and updated, move to the next modItem

        # --- Handle top-level properties (e.g., 'elecPlotDt') ---
        else:
            if key in sourceDict:
                sourceDict[key] = modValue

################################################################


class JarDesigner:
    """The JarDesigner class is used to build models incorporating
    reaction-diffusion and electrical signaling in neurons.
    It takes two arguments: Arg 1 is model specifier which can either be
    a string with the model as a dict, or a filename for a json file.
    Arg 2 is the name of the output plot file and can be None.
    """
    ################################################################
    def __init__(self, jsonFile = None, plotFile = None, jsonData = None,
            verbose = False, dataChannelId = None, sessionDir = None,
            modifiers = {} ):
        schemaFile = "jardesignerSchema.json"
        self.verbose = verbose
        self.dataChannelId = dataChannelId # Used for server-mode jardes
        self.sessionDir = sessionDir # Used for server-mode jardes
        self.runMooView = None      # Used for runtime display
        self.setupMooView = None    # Used to see model during construction
        self.stims = []
        self.moogli = []
        self.chanDistrib = []
        self.chemDistrib = []
        self.passiveDistrib = []
        self.adaptorElecComptList = {}
        self.comptDict = {}     # dict of chem compartments
        self.meshDict = {}      # dict of neuroMesh,spineMesh,psdMesh etc
        self.meshMols = {}      # dict of meshName:[molPathTail] in each mesh
        
        # ================================================================
        # BUG FIX #2: Initialize ALL attributes with defaults FIRST
        # These attributes are now initialized BEFORE JSON loading
        # ================================================================
        self.passiveDistrib = []
        self.plotNames = []
        self.wavePlotNames = []
        self._endos = []
        self._finishedSaving = False
        self._modelFileNameList = []    # Used to build NSDF files
        
        # Construct the absolute path to the schema file
        script_dir = os.path.dirname(os.path.abspath(__file__))
        schemaFile_path = os.path.join(script_dir, schemaFile)

        if not jsonFile and not jsonData:
            print( "No model specified either as file or data" )
            quit()
        if jsonFile and not jsonFile.endswith(".json"):
            print(f"Model file '{jsonFile}' is not a json file.")
            quit()
        if plotFile != None:
            if not (plotFile.endswith(".svg") or plotFile.endswith(".png") or plotFile.endswith(".json") ):
                print(f"Plot file '{plotFile}' should be json or svg or png.")
                quit()
        self.plotFile = plotFile
        with open(schemaFile_path) as f:
            try:
                schema = json.load(f)
            except json.JSONDecodeError as e:
                print(f"schema file {schemaFile_path} did not load")
                print( e )
                quit()
        if jsonFile:
            with open(jsonFile) as f:
                try:
                    data = json.load(f)
                except:
                    print(f"{jsonFile} did not load")
                    quit()
        if jsonData:
            data = jsonData
        try:
            data = addDefaultsRecursive( data, schema )
            jsonschema.validate(instance=data, schema=schema)
            applyModifiers( data, modifiers )
        except jsonschema.exceptions.ValidationError as e:
            print(f"{jsonFile} fails to pass schema: {e}")
            quit()

        #### Now we load in all the fields of the jardesigner class
        #### If JSON contains values for passiveDistrib, plotNames, etc.,
        #### they will naturally overwrite the defaults set above
        for key, value in data.items():
            setattr(self, key, value)
        #### Check for command line overrides of content in json file.
        if verbose:
            self.verbose = True
        #### Some internal fields
        self._endos = []
        self._finishedSaving = False
        self._modelFileNameList = []    # Used to build NSDF files
        #### Some empty defaults
        self.plotNames = [] # Need to get rid of this, use the existing dict
        self.wavePlotNames = [] # Need to get rid of this, use the existing dict

        if not moose.exists( '/library' ):
            library = moose.Neutral( '/library' )
        ## Build the protos
        try:
            self.buildCellProto()
            self.buildChanProto()
            self.buildSpineProto()
            self.buildChemProto()
        except BuildError as msg:
            print("Error: jardesigner: Prototype build failed:", msg)
            quit()

    ################################################################
    def _printModelStats( self ):
        if not self.verbose:
            return
        print("jardesigner: Elec model has",
            self.elecid.numCompartments, "compartments and",
            self.elecid.numSpines, "spines on",
            len( self.comptDict ), "compartments.")
        if hasattr( self , 'chemid') and len( self.chemDistrib ) > 0:
            #  dmstoich = moose.element( self.dendCompt.path + '/stoich' )
            print("    Chem part of model has the following compartments: ")
            for j in moose.wildcardFind( '/model/chem/##[ISA=ChemCompt]'):
                s = moose.element( j.path + '/stoich' )
                print( "    | In {}, {} voxels X {} pools".format( j.name, j.mesh.num, s.numAllPools ) )

    def buildModel( self, modelPath = '/model', numModels = 1, 
            placementFunc = None, tweakFunc = None ):
        if moose.exists( modelPath ):
            print("jardesigner::buildModel: Build failed. Model '",
                modelPath, "' already exists.")
            return False
        self.model = moose.Neutral( modelPath )
        self.modelPath = modelPath
        self.numModels = numModels
        self.placementFunc = placementFunc
        self.tweakFunc = tweakFunc
        funcs = [self.installCellFromProtos, self.buildPassiveDistrib
            , self.buildChanDistrib, self.buildSpineDistrib
            , self.makeArrayOfModels
            , self.buildChemDistrib
            , self._configureChemSolvers
            , self.buildAdaptors, self._buildStims
            , self._buildExtras
            , self._buildPlots, self._buildMoogli, self._buildFileOutput
            , self._configureHSolve
            , self._configureClocks, self._printModelStats]

        #funcs = [self.installCellFromProtos, self.buildPassiveDistrib]
        for i, _func in enumerate(funcs):
            if self.benchmark:
                print("- (%02d/%d) Executing %25s"%(i+1, len(funcs), _func.__name__), end=' ' )
            t0 = time.time()
            try:
                _func()
            except BuildError as msg:
                print("Error: jardesigner: model build failed:", msg)
                moose.delete(self.model)
                return False
            t = time.time() - t0
            if self.benchmark:
                msg = r'    ... DONE'
                if t > 0.01:
                    msg += ' %.3f sec' % t
                print(msg)
            sys.stdout.flush()
        if self.statusDt > min( self.elecDt, self.chemDt, self.diffDt ):
            pr = moose.PyRun( modelPath + '/updateStatus' )
            pr.initString = "_status_t0 = time.time()"
            pr.runString = '''
print( "Wall Clock Time = {:8.2f}, simtime = {:8.3f}".format( time.time() - _status_t0, moose.element( '/clock' ).currentTime ), flush=True )
'''
            moose.setClock( pr.tick, self.statusDt )
        return True

    def installCellFromProtos( self ):
        if self.stealCellFromLibrary:
            moose.move( self.elecid, self.model )
            if self.elecid.name != 'elec':
                self.elecid.name = 'elec'
        else:
            moose.copy( self.elecid, self.model, 'elec' )
            self.elecid = moose.element( self.model.path + '/elec' )
            self.elecid.buildSegmentTree() # rebuild: copy has happened.

        ep = self.elecid.path
        somaList = moose.wildcardFind( ep + '/#oma#[ISA=CompartmentBase]' )
        if len( somaList ) == 0:
            somaList = moose.wildcardFind( ep + '/#[ISA=CompartmentBase]' )
        if len( somaList ) == 0:
            raise BuildError( "installCellFromProto: No soma found" )
        maxdia = 0.0
        for i in somaList:
            if ( i.diameter > maxdia ):
                self.soma = i

    ################################################################
    # Some utility functions for building prototypes.
    ################################################################
    # Return true if it is a function.
    def buildProtoFromFunction( self, func, protoName ):
        if callable( func ):
            func( protoName )
            return True
        bracePos = func.find( '()' )
        if bracePos == -1:
            return False

        # . can be in path name as well. Find the last dot which is most likely
        # to be the function name.
        modPos = func.rfind( "." )
        if ( modPos != -1 ): # Function is in a file, load and check
            resolvedPath = os.path.realpath( func[0:modPos] )
            pathTokens = resolvedPath.split('/')
            pathTokens = ['/'] + pathTokens
            modulePath = os.path.realpath(os.path.join(*pathTokens[:-1]))
            moduleName = pathTokens[-1]
            funcName = func[modPos+1:bracePos]


            moduleFilePath = os.path.join(modulePath, f"{moduleName}.py")

            try:
                # Create a module spec from the file path
                spec = importlib.util.spec_from_file_location(moduleName, moduleFilePath)
                if spec and spec.loader:
                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)
                    # Access the function from the module
                    funcObj = getattr(module, funcName)
                    funcObj(protoName)  # Call the function
                    return True
                else:
                    print(f"Could not load module: {moduleName}")
                    return False
            except Exception as e:
                print(f"Error loading module {moduleName}: {e}")
                return False
            
        # Globally defined function
        fname = func[0:bracePos]
        if fname in globals():
            globals().get( fname )( protoName )
            return True
        elif hasattr(jp, fname):
            getattr( jp, fname )( protoName )
            return True
        else:
            raise BuildError( \
                protoName + " Proto: global function '" +func+"' not known.")
        return False

    # Class or file options. True if extension is found in
    def isKnownClassOrFile( self, name, suffices ):
        for i in suffices:
            if name.rfind( '.'+i ) >= 0 :
                return True
        return False



    # Checks all protos, builds them and return true. If it was a file
    # then it has to return false and invite the calling function to build
    # If it fails then the exception takes over.
    def checkAndBuildProto( self, protoType, protoVec, knownClasses, knownFileTypes ):
        if len(protoVec) != 2:
            raise BuildError( \
                protoType + "Proto: nargs should be 2, is " + \
                    str( len(protoVec)  ))
        if moose.exists( '/library/' + protoVec[1] ):
            # Assume the job is already done, just skip it.
            return True
        # Check if the proto function is already a callable
        if callable( protoVec[0] ):
            return self.buildProtoFromFunction( protoVec[0], protoVec[1] )

        # Check and build the proto from a class name
        if protoVec[0][:5] == 'moose':
            protoName = protoVec[0][6:]
            if self.isKnownClassOrFile( protoName, knownClasses ):
                try:
                    getattr( moose, protoName )( '/library/' + protoVec[1] )
                except AttributeError:
                    raise BuildError( protoType + "Proto: Moose class '" \
                            + protoVec[0] + "' not found." )
                return True

        if self.buildProtoFromFunction( protoVec[0], protoVec[1] ):
            return True
        # Maybe the proto is already in memory
        # Avoid relative file paths going toward root
        if protoVec[0][:3] != "../":
            if moose.exists( protoVec[0] ):
                moose.copy( protoVec[0], '/library/' + protoVec[1] )
                return True
            if moose.exists( '/library/' + protoVec[0] ):
                #moose.copy('/library/' + protoVec[0], '/library/', protoVec[1])
                if self.verbose:
                    print('renaming /library/' + protoVec[0] + ' to ' + protoVec[1])
                moose.element( '/library/' + protoVec[0]).name = protoVec[1]
                return True
        # Check if there is a matching suffix for file type.
        if self.isKnownClassOrFile( protoVec[0], knownFileTypes ):
            return False
        else:
            raise BuildError( \
                protoType + "Proto: File type '" + protoVec[0] + \
                "' not known." )
        return True

    ################################################################
    # Here are the functions to build the type-specific prototypes.
    ################################################################
    def buildCellProto( self ):
        if hasattr( self, "cellProto" ):
            pp = self.cellProto
            ptype = pp["type"]
            if ptype == 'soma':
                self._buildElecSoma( pp["somaDia"], pp["somaLen"] )
            elif ptype == 'ballAndStick':
                self._buildElecBallAndStick( pp )
            elif ptype == 'branchedCell':
                self._buildElecBranchedCell( pp )
            elif ptype == 'func':
                self.buildProtoFromFunction( pp["source"], "elec" )
            elif ptype == 'file':
                fpath = pp['source']
                if self.sessionDir != None:
                    fpath = self.sessionDir + "/" + fpath
                print( "Server log: Loading cell morpho file: ", fpath )
                self._loadElec( fpath, 'cell' )
            elif ptype == 'in_memory':
                self.inMemoryProto( "cell", pp )
            else:
                self._loadElec( pp['source'], 'cell' )
            self.elecid.buildSegmentTree()
        else:
            ''' Make HH squid model sized compartment:
            len and dia 500 microns. CM = 0.01 F/m^2, RA =
            '''
            self.elecid = jp.makePassiveHHsoma( name = 'cell' )
            assert( moose.exists( '/library/cell/soma' ) )
            self.soma = moose.element( '/library/cell/soma' )
            return

    def _inMemoryProto( src, name ):
        if src[:3] != "../":    # Do not permit relative naming of src.
            if moose.exists('/library/'+name):
                return True
            if moose.exists( src ):
                moose.copy( src, '/library/' + name )
                return True
            if moose.exists( '/library/' + src ):
                #moose.copy('/library/' + protoVec[0], '/library/', protoVec[1])
                if self.verbose:
                    print('renaming /library/' + src + ' to ' + name )
                moose.element( '/library/' + src).name = name
                return True
        return False

    def checkAndSetChan( self, sp, field, chan ):
        x = sp.get( field, None ) # Field is one of amparGbar, nmdarGbar, CaTau
        if x == None:
            return
        if moose.exists( f"/library/{sp['name']}/head/{chan}" ):
            elm = moose.element( f"/library/{sp['name']}/head/{chan}" )
            #print( f"Reassigning proto spine field: {chan}.{field}" )
            if field == 'CaTau':
                elm.tau = x
            else:
                spineArea = elm.parent.diameter * elm.parent.length * np.pi
                elm.Gbar = x * spineArea

    def buildSpineProto( self ):
        if hasattr( self, "spineProto" ):
            for sp in self.spineProto:
                stype = sp["type"]
                if stype == 'builtin':
                    self.buildProtoFromFunction( sp['source'], sp['name'] )
                    self.checkAndSetChan( sp, 'amparGbar', 'AMPAR' )
                    self.checkAndSetChan( sp, 'nmdarGbar', 'NMDAR' )
                    self.checkAndSetChan( sp, 'CaTau', 'Ca_conc' )
                elif stype == 'in_memory':
                    if self._inMemoryProto( sp['source'], sp['name'] ):
                        return
                    print( "Error: in memory proto not built ", sp )
                elif stype == 'file':
                    self._loadElec( sp['source'], sp['name'] )

    def parseChanName( self, name ):
        if name[-4:] == ".xml":
            period = name.rfind( '.' )
            slash = name.rfind( '/' )
            if ( slash >= period ):
                raise BuildError( "chanProto: bad filename:" + name )
            if ( slash < 0 ):
                return name[:period]
            else:
                return name[slash+1:period]

    def buildChanProto( self ):
        if hasattr( self, "chanProto" ):
            for cp in self.chanProto:
                ctype = cp["type"]
                if ctype == 'builtin':
                    self.buildProtoFromFunction( cp['source'], cp['name'] )
                elif ctype == 'neuroml':
                    cm = ChannelML( {'temperature': self.temperature} )
                    cm.readChannelMLFromFile( cp['source'] )
                    chanName = self.parseChanName( cp['source'] )
                    if chanName != cp['name']:
                        chan = moose.element( '/library/' + chanName )
                        chan.name = cp['name']

    def buildChemProto( self ):
        if hasattr( self, "chemProto" ):
            for cp in self.chemProto:
                ctype = cp["type"]
                if ctype == 'builtin':
                    self.buildProtoFromFunction( cp['source'], cp['name'] )
                    #self.chemid = moose.element( '/library/' + cp['name'] )
                    comptlist = moose.wildcardFind( '/library/##[ISA=ChemCompt]' )
                    if len( comptlist ) == 0:
                        print("loadChem: No compartment found in file: ", fname)
                        return
                    self.comptDict.update( {cc.name:cc.path for cc in comptlist} )
                elif ctype in ['kkit', 'sbml']:
                    sourceFile = cp['source']
                    if self.sessionDir != None:
                        sourceFile = self.sessionDir + "/" + sourceFile
                    self._loadChem( sourceFile, cp['name'] )
                    #self.chemid = moose.element( '/library/' + cp['name'] )
                #elif ctype == 'in_memory':
                    #self.chemid = moose.element( '/library/' + cp['name'] )
                else:
                    raise BuildError( \
                        "buildChemProto: type not known: " + ctype )


    ################################################################
    def _buildElecSoma( self, dia, dx ):
        cell = moose.Neuron( '/library/cell' )
        jp.buildCompt( cell, 'soma', dia = dia, dx = dx )
        self.elecid = cell
        return cell
        
    ################################################################
    def _buildElecBallAndStick( self, args ):
        parms = [ 'ballAndStick', 'cell', 10e-6, 10e-6, 4e-6, 200e-6, 1 ] # somaDia, somaLen, dendDia, dendLen, dendNumSeg
        cell = moose.Neuron( '/library/cell' )
        prev = jp.buildCompt( cell, 'soma', dia = args['somaDia'], dx = args['somaLen'] )
        dx = args['dendLen']/args['dendNumSeg']
        x = prev.x
        for i in range( args['dendNumSeg'] ):
            compt = jp.buildCompt( cell, 'dend' + str(i), x = x, dx = dx, dia = args['dendDia'] )
            moose.connect( prev, 'axial', compt, 'raxial' )
            prev = compt
            x += dx
        self.elecid = cell
        return cell

    ################################################################
    def _buildElecBranchedCell( self, args ):
        cell = moose.Neuron( '/library/cell' )
        prev = jp.buildCompt( cell, 'soma', dia = args["somaDia"], dx = args["somaLen"] )
        dx = args["dendLen"]/args["dendNumSeg"]
        x = prev.x
        for i in range( args["dendNumSeg"] ):
            compt = jp.buildCompt( cell, 'dend' + str(i), x = x, dx = dx, dia = args["dendDia"] )
            moose.connect( prev, 'axial', compt, 'raxial' )
            prev = compt
            x += dx
        primaryBranchEnd = prev
        x = prev.x
        y = prev.y
        dxy = (args["branchLen"]/float(args["branchNumSeg"])) * np.sqrt( 1.0/2.0 )
        for i in range( args["branchNumSeg"] ):
            compt = jp.buildCompt( cell, 'branch1_' + str(i), 
                    x = x, dx = dxy, y = y, dy = dxy, 
                    dia = args["branchDia"] )
            moose.connect( prev, 'axial', compt, 'raxial' )
            prev = compt
            x += dxy
            y += dxy

        x = primaryBranchEnd.x
        y = primaryBranchEnd.y
        prev = primaryBranchEnd
        for i in range( args["branchNumSeg"] ):
            compt = jp.buildCompt( cell, 'branch2_' + str(i), 
                    x = x, dx = dxy, y = y, dy = -dxy, 
                    dia = args["branchDia"] )
            moose.connect( prev, 'axial', compt, 'raxial' )
            prev = compt
            x += dxy
            y -= dxy

        self.elecid = cell
        return cell

    ################################################################
    def _buildVclampOnCompt( self, dendCompts, spineCompts ):
        stimObj = []
        for i in dendCompts + spineCompts:
            vclamp = jp.make_vclamp( name = 'vclamp', parent = i.path )

            # Assume SI units. Scale by Cm to get reasonable gain.
            vclamp.gain = i.Cm * 1e4 
            moose.connect( i, 'VmOut', vclamp, 'sensedIn' )
            moose.connect( vclamp, 'currentOut', i, 'injectMsg' )
            stimObj.append( vclamp )

        return stimObj

    def _buildSynInputOnCompt( self, dendCompts, spineCompts, stimInfo, doPeriodic = False ):
        synWeight = stimInfo['weight']
        stimObj = []
        for i in dendCompts + spineCompts:
            path = i.path + '/' + stimInfo['relpath'] + '/sh/synapse[0]'
            if moose.exists( path ):
                synInput = jp.make_synInput( name='synInput', parent=path )
                synInput.doPeriodic = doPeriodic
                moose.element(path).weight = synWeight
                moose.connect( synInput, 'spikeOut', path, 'addSpike' )
                stimObj.append( synInput )
        return stimObj
        
    ################################################################
    # Here we set up the distributions
    ################################################################
    def buildPassiveDistrib( self ):
	# [path field expr [field expr]...]
        # RM, RA, CM set specific values, per unit area etc.
        # Rm, Ra, Cm set absolute values.
        # Also does Em, Ek, initVm
	# Expression can use p, g, L, len, dia, maxP, maxG, maxL.
        temp = []
        for i in self.passiveDistrib:
            assert( "path" in i )
            temp.append( "." )
            temp.append( i["path"] )
            for key, val in i.items():
                if key != "path":
                    temp.append( key )
                    temp.append( str( val ) )
            temp.append( "" )
        #print( "Passive distrib = ", temp )
        self.elecid.passiveDistribution = temp

    def buildChanDistrib( self ):
        if not hasattr( self, 'chanDistrib' ):
            return
        temp = []
        for i in self.chanDistrib:
            if 'Gbar' in i:
                val = str( i['Gbar'] )
                temp.extend( [i['proto'], i['path'], 'Gbar', str(i['Gbar']) ] )
            elif 'tau' in i:
                temp.extend([i['proto'], i['path'], 'tau', str(i['tau']) ])
            else:
                continue
            temp.extend( [""] )
        self.elecid.channelDistribution = temp

    def buildSpineDistrib( self ):
        if not hasattr( self, 'spineDistrib' ):
            return
        # ordering of spine distrib is
        # name, path, spacing, spacingDistrib, size, sizeDistrib, angle, angleDistrib
        # [i for i in L1 if i in L2]
        # The first two args are compulsory, and don't need arg keys.
        usageStr = 'Usage: name, path, [spacing, spacingDistrib, size, sizeDistrib, angle, angleDistrib]'
        temp = []
        defaults = ['spine', '#dend#,#apical#', '10e-6', '1e-6', '1', '0.5', '0', '6.2831853' ]
        argKeys = ['proto', 'path', 'spacing', 'minSpacing', 'sizeScale', 'sizeSdev', 'angle', 'angleSdev' ]
        argKeys2 = ['proto', 'path', 'spacing', 'spacingDistrib', 'size', 'sizeDistrib', 'angle', 'angleDistrib' ]
        for ii in self.spineDistrib:
            moose.seed( ii['randSeed'] ) # 0 is system, >=1 is specific seed.
            line = []
            for jj in argKeys[:2]:
                line.append( ii[jj] )
            for jj, kk in zip (argKeys[2:], argKeys2[2:] ):
                line.append( kk )       # Put in the name the C code knows
                line.append( str(ii[jj]) )   # Put in the value from json dict
            temp.extend( line + [''] )

        self.elecid.spineDistribution = temp

    def newChemDistrib( self, argList, comptDict ):
        if not moose.exists( '/model/chem' ):
            moose.Neutral( '/model/chem' )
        # meshOrder = ['soma', 'dend', 'spine', 'psd', 'psd_dend', 'presyn_dend', 'presyn_spine', 'endo', 'endo_axial']
        chemSrc = argList['proto']
        elecPath = argList['path']
        meshType = argList['type']
        #print( "chemSrc={}, elecPath={}, meshType = {}".format( chemSrc, elecPath, meshType ) )
        #chemSrc, elecPath, meshType, geom = argList[:4]
        chemSrcObj = comptDict.get( chemSrc )
        if not chemSrcObj:
            print( "COMPT DICT = ", comptDict )
            raise BuildError( "newChemDistrib: Could not find chemSrcObj: " + chemSrc )
        if meshType in ['soma', 'endo_soma', 'psd_dend']:
            raise BuildError( "newChemDistrib: Can't yet handle meshType: " + meshType )
        newChemId = moose.copy( chemSrcObj, '/library', 'temp_chem' )
        if meshType == 'dend':
            mesh = moose.NeuroMesh( '/model/chem/' + chemSrc )
            mesh.geometryPolicy = 'cylinder'
            mesh.separateSpines = 0
        elif meshType == 'spine':
            mesh = self.buildSpineMesh( argList, newChemId, comptDict )
        elif meshType == 'psd':
            mesh = self.buildPsdMesh( argList, newChemId, comptDict )
        elif meshType == 'presyn_dend' or meshType == 'presyn_spine':
            mesh = self.buildPresynMesh( argList, newChemId )
        elif meshType == 'endo' or meshType == 'endo_axial':
            # Earlier we did this after building. I think it should be OK
            # as we have already set up the dend mesh because of the order
            # of going through this loop.
            mesh = self.buildEndoMesh( argList, newChemId )
        else:
            raise BuildError( "newChemDistrib: ERROR: No mesh of specified type found: " + meshType )

        #mesh.setVolumeNotRates( newChemId.volume )
        self._moveCompt( newChemId[0], mesh )
        self.meshDict[chemSrc] = mesh.path

    def buildSpineMesh( self, argList, newChemId, comptDict ):
        chemSrc = argList['proto']
        dendMeshName = argList["parent"]
        dendMesh = self.meshDict.get( dendMeshName )
        #print( "meshDict = ", self.meshDict )
        if not dendMesh:
            moose.le( '/model/elec' )
            raise BuildError( "Error: buildSpineMesh: Missing parent NeuroMesh '{}' for spine '{}'".format( dendMeshName, chemSrc ) )
        #print( "COMPT DICT ============", comptDict )
        moose.element(dendMesh).separateSpines = 1
        mesh = moose.SpineMesh( '/model/chem/' + chemSrc )
        moose.connect( dendMesh, 'spineListOut', mesh, 'spineList' )
        return mesh

    def buildPsdMesh( self, argList, newChemId, comptDict ):
        chemSrc = argList['proto']
        dendMeshName = argList["parent"]
        dendMesh = self.meshDict.get( dendMeshName )
        if not dendMesh:
            raise BuildError( "Error: buildPsdMesh: Missing parent NeuroMesh '{}' for psd '{}'".format( dendMeshName, chemSrc ) )
        mesh = moose.PsdMesh( '/model/chem/' + chemSrc )
        moose.connect( dendMesh, 'psdListOut', mesh, 'psdList','OneToOne')
        return mesh
            
    def buildPresynMesh( self, argList, newChemId ):
        chemSrc = argList['proto']
        elecPath = argList['path']
        meshType = argList['type']
        mesh = moose.PresynMesh( '/model/chem/' + chemSrc )
        #pair = elecPath + " " + geom
        pair = elecPath + " 1"
        if meshType == 'presyn_dend':
            presynRadius = float( argList["radius"] )
            presynRadiusSdev = float( argList["radiusSdev"] )
            presynSpacing = float( argList["spacing"] )
            elecList = self.elecid.compartmentsFromExpression[ pair ]
            mesh.buildOnDendrites( elecList, presynSpacing )
        else:
            presynRadius = float( argList["radiusByPsd"] )
            presynRadiusSdev = float( argList["radiusByPsdSdev"] )
            elecList = self.elecid.compartmentsFromExpression[ pair ]
            mesh.buildOnSpineHeads( elecList )
        mesh.setRadiusStats( presynRadius, presynRadiusSdev )
        return mesh

    def buildEndoMesh( self, argList, newChemId ):
        chemSrc = argList['proto']
        elecPath = argList['path']
        meshType = argList['type']
        mesh = moose.EndoMesh( '/model/chem/' + chemSrc )
        surroundName = argList["parent"]
        radiusRatio = float( argList["radiusRatio"] )
        surroundMesh = self.meshDict.get( surroundName )
        #print( "NAME = ", surroundName, "    MEHS = ", surroundMesh )
        if not surroundMesh:
            raise BuildError( "Error: buildEndoMesh: Could not find surround '{}' for endo '{}'".format( surroundName, chemSrc ) )
        #mesh.surround = moose.element( newChemId.path+'/'+surroundName )
        mesh.surround = moose.element(surroundMesh)
        mesh.isMembraneBound = True
        mesh.rScale = radiusRatio
        if meshType == 'endo_axial':
            mesh.doAxialDiffusion = 1
            mesh.rPower = 0.5
            mesh.aPower = 0.5
            mesh.aScale = radiusRatio * radiusRatio
        self._endos.append( [mesh, surroundMesh] )
        return mesh


    def _fixSpine( self ):
        # Hack to include PSD if spine is there but no PSD.
        # Needed because solvers expect it. May complain because no mol
        spineLine = [ii for ii in self.chemDistrib if ii['type']== 'spine']
        numPsd = len([ii for ii in self.chemDistrib if ii['type']== 'psd'])
        if len( spineLine ) > 0 and numPsd == 0:
            if moose.exists('/model/chem/' + spineLine[0]['proto']):
                dummyParent = '/model/chem'
            elif moose.exists( '/model/chem/kinetics/' + spineLine[0]['proto']):
                dummyParent = '/model/chem/kinetics'
            else:
                print( "Error: spine compartment '{}' specified, also need psd compartment.".format( spineLine[0]['proto'] )  )
                quit()
            psdLine = dict( spineLine[0] )
            dummyPSD = moose.CubeMesh( dummyParent + "/dummyPSD" )
            psdLine['proto'] = 'dummyPSD'
            psdLine['type'] = 'psd'
            self.chemDistrib.append( psdLine )

    def buildChemDistrib( self ):
        if not hasattr( self, 'chemDistrib' ):
            return
        if len( self.chemDistrib ) == 0:
            return
        self._fixSpine()
        for model in self.modelList:
            self._buildOneChemDistrib( model )

    def _buildOneChemDistrib( self, model ):
        sortedChemDistrib = sorted( self.chemDistrib, key = lambda c: meshOrder.index( c['type'] ) )
        for i in sortedChemDistrib:
            self.newChemDistrib( i, self.comptDict )
        #print( "USING meshDICT = ", self.meshDict )
        # We have to assign the compartments to neuromesh and
        # spine mesh only after they have all been connected up.
        for i in sortedChemDistrib:
            chemSrc = i['proto']
            elecPath = i['path']
            meshType = i['type']
            if i['type'] == 'dend':
                dendMesh = moose.element(self.meshDict[i['proto']])
                if self.verbose:
                    print( "DendMesh path = ", dendMesh.path )
                #pair = i['path'] + " " + geom
                pair = i['path'] + " 1"
                dendMesh.diffLength = i.get( 'diffusionLength', self.diffusionLength )

                dendMesh.subTree = self.elecid.compartmentsFromExpression[ pair ]
            '''
            if i['type'] == 'endo' or i['type'] == 'endo_axial': 
                # Should come after dend
                mesh = self.buildEndoMesh( i, newChemId )
                chemSrcObj = self.comptDict.get( i['proto'] )
                #mesh.setVolumeNotRates( newChemId.volume )
                self._moveCompt( chemSrcObj, mesh )
                self.meshDict[chemSrc] = mesh.path
            '''

    ################################################################
    # Here we make copies of the model in nx and ny.
    ################################################################

    def _positionModelObj( self, obj, idx ):
        if not self.placementFunc:
            return
        dx, dy, dz = self.placementFunc( self.numModels, idx )
        for ee in moose.wildcardFind(obj.path+"/##[ISA=CompartmentBase]"):
            ee.x += dx
            ee.x0 += dx
            ee.y += dy
            ee.y0 += dy
            ee.z += dz
            ee.z0 += dz
            #ee.displace( dx, dy, dz ) # Don't have it defined in pybind11
            #print( ee.x0, ee.y0, ee.z0 )

    def makeArrayOfModels( self ):
        self.modelList = []
        self._positionModelObj( self.model, 0 )
        self.modelList.append(self.model)
        parent = self.model.parent.path

        for idx in range( 1, self.numModels ):
            name = "{}_{}".format( self.model.name, idx )
            dup = moose.copy( self.model, parent, name, 1 )
            self._positionModelObj( dup[0], idx )
            self.modelList.append( dup[0] ) # dup is a vec

    ################################################################
    # Here we call any extra building function supplied by user.
    ################################################################

    def _buildExtras( self ):
        # self.extraBuildFunction( self )
        if not self.tweakFunc:
            return
        for idx, model in enumerate( self.modelList ):
            self.tweakFunc( idx, model.path )


    ################################################################
    # Here we set up the adaptors
    ################################################################
    def findMeshOnName( self, name ):
        pos = name.find( '/' )
        if ( pos != -1 ):
            temp = name[:pos]
            if temp == 'psd' or temp == 'spine' or temp == 'dend':
                return ( temp, name[pos+1:] )
            elif temp in self.comptDict:
                return ( temp, name[pos+1:] )
        return ("","")


    def buildAdaptors( self ):
        if not hasattr( self, 'adaptors' ):
            return
        for i in self.adaptors:
            mesh, name = self.findMeshOnName( i['source'] )
            if mesh == "":
                mesh, name = self.findMeshOnName( i['dest'] )
                if  mesh == "":
                    raise BuildError( "buildAdaptors: Failed for " + i['dest'] )
                self._buildAdaptor( mesh, i['source'], i['sourceField'], name, i['destField'], True, i['baseline'], i['slope'] )
            else:
                self._buildAdaptor( mesh, i['dest'], i['destField'], name, i['sourceField'], False, i['baseline'], i['slope'] )

    ################################################################
    # Here we set up the plots. Dummy for cases that don't match conditions
    ################################################################
    def _collapseElistToPathAndClass( self, comptList, path, className ):
        dummy = moose.element( '/' )
        ret = [ dummy ] * len( comptList )
        j = 0
        for i in comptList:
            if moose.exists( i.path + '/' + path ):
                obj = moose.element( i.path + '/' + path )
                if obj.isA[ className ]:
                    ret[j] = obj
            j += 1
        return ret

    # Utility function for doing lookups for objects.
    def _makeUniqueNameStr( self, obj ):
        # second one is faster than the former. 140 ns v/s 180 ns.
        #  return obj.name + " " + str( obj.index )
        return "%s %s" % (obj.name, obj.index)

    # Returns vector of source objects, and the field to use.
    # plotDict has entries: relpath, field, 
    def _parseComptField( self, comptList, plotDict, knownFields ):
        # Put in stuff to go through fields if the target is a chem object
        field = plotDict['field']
        if not field in knownFields:
            print("Warning: jardesigner::_parseComptField: Unknown field '{}'".format( field ) )
            return (), ""

        kf = knownFields[field] # Find the field to decide type.
        if kf[0] in ['CaConcBase', 'ChanBase', 'NMDAChan', 'VClamp']:
            objList = self._collapseElistToPathAndClass( comptList, plotDict['relpath'], kf[0] )
            return objList, kf[1]
        elif field in [ 'n', 'conc', 'nInit', 'concInit', 'volume', 'increment']:
            path = plotDict['relpath'] # e.g., chemMesh/[group/]poolName
            pos = path.find( '/' )
            if pos == -1:   # Assume it is in the first chem compartment.
                el = moose.wildcardFind( self.modelPath + "/chem/##[ISA=ChemCompt]" )
                if len( el ) == 0:
                    raise BuildError( "parseComptField: no compartment on: " + self.modelPath )
                chemComptName = el[0].name
                #chemComptName = 'dend'
                path  = chemComptName + '/' + path
                cc = moose.element(self.modelPath + '/chem/'+chemComptName)
            else:
                chemComptName = path.split('/')[0]
                el = moose.wildcardFind( self.modelPath + "/chem/##[ISA=ChemCompt]" )
                cc = moose.element( '/' )
                for elm in el:
                    if elm.name == chemComptName:
                        cc = elm
                        break
            if cc.path == '/':
                print( "ERROR: path = ", path, chemComptName, field, flush = True )
                raise BuildError( "parseComptField: no chemMesh named: " + chemComptName )
            voxelVec = []
            temp = [ self._makeUniqueNameStr( i ) for i in comptList ]
            comptSet = set( temp )
            em = sorted( [ self._makeUniqueNameStr(i[0]) for i in cc.elecComptMap ] )

            # The indexing in the voxelVec need not overlap with the 
            # indexing in the chem path. Need to just go by lengths.
            voxelVec = [i for i in range(len( em ) ) if em[i] in comptSet ]
            # Here we collapse the voxelVec into objects to plot.
            p = plotDict['relpath']
            if ( p[-1] == "]") and not( p[-2] == "[" ) :
                allObj = [moose.element( self.modelPath + '/chem/' + p ) ]
            else:
                allObj = moose.vec( self.modelPath + '/chem/' + plotDict['relpath'] )
            nd = len( allObj )
            objList = [ allObj[j] for j in voxelVec if j < nd]
            #print "############", chemCompt, len(objList), kf[1]
            return objList, kf[1]

        else:
            return comptList, kf[1]


    def _buildPlots( self ):
        if not hasattr( self, 'plots' ):
            return
        for model in self.modelList:
            self._buildOnePlot( model )

    def _buildOnePlot( self, model ):
        knownFields = {
            'Vm':('CompartmentBase', 'getVm', 1000, 'Memb. Potential (mV)' ),
            'spikeTime':('CompartmentBase', 'getVm', 1, 'Spike Times (s)'),
            'Im':('CompartmentBase', 'getIm', 1e9, 'Memb. current (nA)' ),
            'Cm':('CompartmentBase', 'getCm', 1e12, 'Memb. capacitance (pF)' ),
            'Rm':('CompartmentBase', 'getRm', 1e-9, 'Memb. Res (GOhm)' ),
            'Ra':('CompartmentBase', 'getRa', 1e-6, 'Axial Res (MOhm)' ),
            'inject':('CompartmentBase', 'getInject', 1e9, 'inject current (nA)' ),
            'Gbar':('ChanBase', 'getGbar', 1e9, 'chan max conductance (nS)' ),
            'modulation':('ChanBase', 'getModulation', 1, 'chan modulation (unitless)' ),
            'Gk':('ChanBase', 'getGk', 1e9, 'chan conductance (nS)' ),
            'Ik':('ChanBase', 'getIk', 1e9, 'chan current (nA)' ),
            'ICa':('NMDAChan', 'getICa', 1e9, 'Ca current (nA)' ),
            'Ca':('CaConcBase', 'getCa', 1e3, 'Ca conc (uM)' ),
            'n':('PoolBase', 'getN', 1, '# of molecules'),
            'conc':('PoolBase', 'getConc', 1000, 'Concentration (uM)' ),
            'nInit':('PoolBase', 'getNInit', 1, '# of molecules'),
            'concInit':('PoolBase', 'getConcInit', 1000, 'Concentration (uM)' ),
            'volume':('PoolBase', 'getVolume', 1e18, 'Volume (um^3)' ),
            'current':('VClamp', 'getCurrent', 1e9, 'Holding Current (nA)')
        }
        graphs = moose.Neutral( model.path + '/graphs' )
        elecid = moose.element( model.path + '/elec' )
        dummy = moose.element( '/' )
        k = 0
        for i in self.plots:
            # GeomExpr removed for plots
            #pair = i['path'] + ' ' + i.geom_expr 
            pair = i['path'] + ' 1'
            dendCompts = elecid.compartmentsFromExpression[ pair ]
            #spineCompts = elecid.spinesFromExpression[ pair ]
            plotObj, plotField = self._parseComptField( dendCompts, i, knownFields )
            numPlots = sum( q != dummy for q in plotObj )
            #print( "PlotList: {0}: numobj={1}, field ={2}, nd={3}, ns={4}".format( pair, numPlots, plotField, len( dendCompts ), len( spineCompts ) ) )
            objList = [] # Used to fill in ObjIds of plotted objects.
            if numPlots > 0:
                tabname = graphs.path + '/plot' + str(k)
                scale = knownFields[i['field']][2]
                units = knownFields[i['field']][3]
                if 'title' in i:
                    title = i['title']
                else:
                    title = i['path'] + "." + i['field']
                if i['mode'] == 'wave':
                    self.wavePlotNames.append( [ tabname, title, k, scale, units, i, objList ] )
                elif i['mode'] == 'time': 
                    self.plotNames.append( [ tabname, title, k, scale, units, i['field'], i['ymin'], i['ymax'], objList ] )
                else:
                    print( "Can't handle {} plots".format(i['mode']) )

                k += 1
                if i['field'] in ['n', 'conc', 'Gbar' ]:
                    tabs = moose.Table2( tabname, numPlots )
                else:
                    tabs = moose.Table( tabname, numPlots )
                    if i['field'] == 'spikeTime':
                        tabs.vec.threshold = -0.02 # Threshold for classifying Vm as a spike.
                        tabs.vec.useSpikeMode = True # spike detect mode on

            vtabs = moose.vec( tabs )
            q = 0
            for p in [ x for x in plotObj if x != dummy ]:
                #print( p.path, plotField, q )
                moose.connect( vtabs[q], 'requestOut', p, plotField )
                objList.append( p )
                q += 1

    def _buildMoogli( self ):
        if not hasattr( self, 'moogli' ):
            return
        knownFields = knownFieldsDefault
        moogliBase = moose.Neutral( self.modelPath + '/moogli' )
        self.runMooView = jarmoogli.MooView( self.dataChannelId )
        for idx, i in enumerate( self.moogli ):
            path = i['path'].split('/')[-1]
            path2 = path.replace( '#', 'hash' )
            path3 = path2.replace( '[', '_' )
            path4 = path3.replace( ']', '_' )
            groupId = "{}_{}_{}".format( path4, i['field'], idx )
            kf = knownFields[i['field']]
            pair = i['path'] + " 1"  # I'm replacing geom_expr with '1'
            dendCompts = self.elecid.compartmentsFromExpression[ pair ]
            #spineCompts = self.elecid.spinesFromExpression[ pair ]
            dendObj, mooField = self._parseComptField( dendCompts, i, knownFields )
            numMoogli = len( dendObj )
            iObj = DictToClass( i ) # Used as 'args' in makeMoogli
            pr = moose.PyRun( '/model/moogli_' + groupId )
            pr.runString = "import jardesigner.context; rdes = jardesigner.context.getContext(); rdes.runMooView.updateMoogliViewer({})".format(idx)
            pr.tick = idx + 20
            #moose.setClock( pr.tick, i["dt"] )
            fdict = i.copy()
            ff = fdict['field']
            fdict['dataUnits'] = knownFieldInfo[ff]['dataUnits']
            fdict['dataType'] = knownFieldInfo[ff]['dataType']
            fdict['diaScale'] = i.get( "diaScale", 1 )
            if not fdict.get( 'title' ):
                fdict['title'] = "{} {} {}".format( fdict['path'], 
                        fdict['field'], fdict['dataUnits'] )
            if not fdict.get( 'dt' ):
                if fdict['field'] in ['conc', 'concInit', 'n', 'nInit', 'volume']:
                    fdict['dt'] = 0.2
                else:
                    fdict['dt'] = 0.001
            if not fdict.get( 'relpath' ):
                fdict[ 'relpath'] = '.'

            moose.setClock( pr.tick, fdict['dt'] )
            self.runMooView.makeMoogli( dendObj, fdict, groupId )
            # Here we set aside info for setupMooView
            i['moogliObjList'] = dendObj


    def getFirstMol( self, protoName ):
        mols = moose.wildcardFind(f"/model/chem/{protoName}/##[ISA=PoolBase]")
        if len(mols) == 0:
            return ""
        return mols[0].name

    def fillMeshMols( self ):
        chemCompts = moose.wildcardFind( "/library/##[ISA=ChemCompt]")
        #print( "CHEM COMPTS = ", chemCompts )
        chemComptPaths = [ cc.path for cc in chemCompts ]
        for cc in chemCompts:
            ret = []
            lp = len( cc.path )
            elist = moose.wildcardFind( cc.path + "/##[0][ISA=PoolBase]" )
            for elm in elist:
                path = elm.path[lp:].replace( "[0]", "" )
                if path[0] == '/':
                    path = path[1:]
                ret.append( path )
            self.meshMols[ cc.name ] = ret

    def _buildReactionGraph( self ):
        #rpath = os.path.abspath(os.path.join(self.sessionDir, "reaction_graph.json") )
        return jrg.get_reaction_graph( "/library" )

    def _buildSetupMoogli( self ):
        self.setupMooView = jarmoogli.MooView( self.dataChannelId )
        comptGroupId = "{}_{}_{}".format( "compt", "Vm", 0 )
        spineGroupId = "{}_{}_{}".format( "spine", "Vm", 0 )
        allcompts = moose.wildcardFind( self.elecid.path + "/#[ISA=CompartmentBase]" )
        spines = moose.wildcardFind( "{0}/shaft#,{0}/head#".format(self.elecid.path ) )
        compts = list( set( allcompts ) - set( spines ) )

        self.setupMooView.makeMoogli( compts, dict(DefaultFdict), comptGroupId )
        if len( spines ) > 0:
            sdict = dict( DefaultFdict )
            sdict['title'] = 'Spines'
            self.setupMooView.makeMoogli( spines, sdict, spineGroupId )

        cdict = dict( DefaultFdict )
        cdict['field'] = 'conc'
        self.fillMeshMols()
        #print( "MESHMOLS = ", self.meshMols )
        for protoName, meshPath in self.meshDict.items():
            mname = self.getFirstMol( protoName )
            #print( "PROTONAME vs meshPath: ", protoName, meshPath )
            if mname == "":
                print( f"Warning, no molecules found for {protoName}")
                moose.le( '/model/chem' )
                continue
            molGroupId = f"{protoName}_conc_0"
            mols = moose.wildcardFind( f"{meshPath}/{mname}[]" )
            #print( "NUM MOLS = ", len(mols), "mesh = ", meshPath, "mol = ", mname )
            #print( "MOL0 coords = ", mols[0].coords )
            cdict['title'] = f"Chem: {protoName}"
            self.setupMooView.makeMoogli( mols, cdict, molGroupId )

        # Later also check for any chem, stim, plot etc and add those.
        # PlotName entry has  [ tabname, title, idx_of_tab, scale, units, 
        #                       field, ymin, ymax, objList ]
        pdict = dict( DefaultFdict )
        pdict["field"] = "other"
        pdict["dataType"] = "plot"
        for idx, pp in enumerate( self.plotNames ):
            pdict["title"] = "plot_" + pp[1]
            pdict["iconNum"] = idx
            plotGroupId = f"{pp[1]}.{pp[5]}.{pp[2]}" # title.field.idx
            self.setupMooView.makeMoogli( pp[8], pdict, plotGroupId )

        pdict["field"] = "other"
        for idx, ss in enumerate( self.stims ):
            pdict["dataType"] = "stim"
            pdict["title"] = "stim_" + ss['path']
            pdict["iconNum"] = idx
            if ss['type'] == 'field' and ss['field'] == 'vclamp': 
                pdict["dataType"] = "vclamp" # Use special icon here
            stimGroupId = f"{ss['path']}.{idx}" # path.idx
            self.setupMooView.makeMoogli( ss['stimObjList'], pdict, stimGroupId )

        pdict["field"] = "other"
        pdict["dataType"] = "moogli"
        for idx, mm in enumerate( self.moogli ):
            pdict["title"] = "moogli_" + mm['title']
            pdict["iconNum"] = idx
            moogliGroupId = f"{mm['path']}.{idx}" # path.idx
            self.setupMooView.makeMoogli( mm['moogliObjList'], pdict, moogliGroupId )

        pdict["field"] = "other"
        pdict["dataType"] = "chan"
        for idx, cc in enumerate( self.chanDistrib ):
            pdict["relpath"] = cc['proto']
            pdict["title"] = "chan_" + cc['proto']
            pdict["iconNum"] = idx
            chanGroupId = f"{cc['proto']}.{idx}" # proto.idx
            # Note this finds the path of the parent compts, not chans.
            objList = moose.wildcardFind( f"/model/elec/{cc['path']}" )
            #print( "CCCCCCCCHHHAN: objList = ", objList )
            self.setupMooView.makeMoogli( objList, pdict, chanGroupId )

        # Register spine receptor channels (AMPAR, NMDAR, Ca_conc) as invisible
        # chan drawables. They are absent from chanDistrib but are physically
        # present on spine heads for excitatory and excitatory_with_Ca spine
        # types. visible=False suppresses per-spine icons (which would be
        # cluttered) while still registering them in the scene graph so that
        # GUI menus can offer them as relpath options.
        spineDict = dict( DefaultFdict )
        spineDict["field"] = "other"
        spineDict["dataType"] = "chan"
        spineDict["visible"] = False
        spineIdx = len( self.chanDistrib )
        for chanName in ['AMPAR', 'NMDAR', 'Ca_conc']:
            chanObjs = moose.wildcardFind(
                f"{self.elecid.path}/#head#/{chanName}" )
            if len( chanObjs ) == 0:
                continue
            headCompts = [c.parent for c in chanObjs]
            spineDict["relpath"] = chanName
            spineDict["title"] = "chan_" + chanName
            spineDict["iconNum"] = spineIdx
            chanGroupId = f"{chanName}.spine.{spineIdx}"
            self.setupMooView.makeMoogli( headCompts, spineDict, chanGroupId )
            spineIdx += 1

        pdict["field"] = "other"
        pdict["dataType"] = "adaptor"
        for idx, adname in enumerate( self.adaptorElecComptList ):
            (elecRelPath, chemRelPath, objList) = self.adaptorElecComptList[adname]
            #print( "AAAAADAPTOR: objList = ", objList )
            #print( "AAAAANAME = ", objList[0].name, objList[0].dataIndex )
            pdict["relpath"] = f"{elecRelPath}_to_{chemRelPath}"
            pdict["title"] = adname
            pdict["iconNum"] = idx
            adaptGroupId = f"{adname}.{idx}" # proto.idx
            # ObjList has the parent elec compts
            self.setupMooView.makeMoogli( objList, pdict, adaptGroupId )
    

    def _buildFileOutput( self ):
        if not hasattr( self, 'files' ) or len( self.files ) == 0:
            return
        fileBase = moose.Neutral( self.modelPath + "/file" )
        knownFields = knownFieldsDefault

        nsdfBlocks = {}
        nsdf = None

        for idx, ff in self.files:
            oname = ff['file'].split( "." )[0]
            if ff['type'] in ['nsdf', 'hdf5', 'h5']:
                nsdf = moose.element( ff['path'] )
                nsdfPath = fileBase.path + '/' + oname
                if ff['field'] in ["n", "conc"]:
                    modelPath = self.modelPath + "/chem" 
                    basePath = modelPath + "/" + ff['path']
                    if ff['path'][-1] in [']', '#']: # explicit index
                        pathStr = basePath + "." + ff['field']
                    else:
                        pathStr = basePath + "[]." + ff['field']
                else:
                    modelPath = self.modelPath + "/elec" 
                    spl = ff['path'].split('/')
                    if spl[0][-1] == "#":
                        if len( spl ) == 1:
                            ff['path'] = spl[0]+"[ISA=CompartmentBase]"
                        else:
                            ff['path'] = spl[0]+"[ISA=CompartmentBase]/" + ff['path'][1:]


                    # Otherwise we use basepath as is.
                    basePath = modelPath + "/" + ff['path']
                    pathStr = basePath + "." + fentry['field']
                if not nsdfPath in nsdfBlocks:
                    self.nsdfPathList.append( nsdfPath )
                    nsdfBlocks[nsdfPath] = [pathStr]
                    nsdf = moose.NSDFWriter2( nsdfPath )
                    nsdf.modelRoot = "" # Blank means don't save tree.
                    nsdf.filename = fentry['file']
                    # Insert the model setup files here.
                    nsdf.mode = 2
                    # Number of timesteps between flush
                    nsdf.flushLimit = ff['flushSteps']   
                    nsdf.tick = 20 + len( nsdfBlocks )
                    moose.setClock( nsdf.tick, ff['dt'] )
                    mfns = sys.argv[0]
                    for ii in self._modelFileNameList:
                        mfns += "," + ii
                    nsdf.modelFileNames = mfns 
                else:
                    nsdfBlocks[nsdfPath].append( pathStr )
        for nsdfPath in self.nsdfPathList:
            nsdf = moose.element( nsdfPath )
            nsdf.blocks = nsdfBlocks[nsdfPath]


    ################################################################
    # Here we display the plots and moogli
    ################################################################

    def _displayMoogli( self ):
        if not hasattr( self, 'moogli' ) or not hasattr( self, 'displayMoogli' ):
            return False
        if len( self.moogli ) == 0:
            return False
        dm = self.displayMoogli
        
        mvf = dm.get("movieFrame")
        if mvf and mvf['w'] > 0 and mvf['h'] > 0:
            mvfArray = [mvf['x'], mvf['y'], mvf['w'], mvf['h']]
        else:
            mvfArray = []
        
        # If center is empty then use autoscaling.
        jarmoogli.displayMoogli( self, 
                dm["dt"], dm['runtime'], rotation = dm['rotation'], 
                fullscreen = dm['fullscreen'], azim = dm['azim'], 
                elev = dm['elev'], 
                mergeDisplays = dm['mergeDisplays'], 
                colormap = dm['colormap'], 
                center = dm['center'], bg = dm['bg'], 
                animation = dm['animation'], 
                movieFrame = mvfArray
                #block = dm['block']
        )
        moose.reinit()
        moose.start( dm["runtime"] )
        self._save()                                            
        self.runMooView.notifySimulationEnd(self.dataChannelId)
        if dm["block"] or self.plotFile != None:
            self.display( len( self.moogNames ) + 1)
        while True:
            time.sleep(1)
        return True

    def _display( self, startIndex = 0, block=True ):
        moose.reinit()
        moose.start( self.runtime )
        self._save()                                            
        self.display( startIndex, block )

    def plots2json( self, nrows, ncols, plotFile ):
        numPlots = len( self.plotNames )
        payload = { "numPlots": numPlots,
                "nrows": nrows,
                "ncols": ncols,
                "plots": []
        }
        for idx, pp in enumerate( self.plotNames ):
            vtab = moose.vec( pp[0] )
            payload["plots"].append( 
                {
                    "title": pp[1],
                    "xlabel": "Time (s)",
                    "ylabel": pp[4],
                    "isRaster": (pp[5] == "spikeTime"),
                    "numSubPlots": len( vtab ),
                    "tmax": moose.element( "/clock").currentTime,
                    "dt": vtab[0].dt,
                    "val": [(vv.vector*pp[3]).tolist() for vv in vtab]
                } 
            )
        with open(plotFile, 'w') as f:
            json.dump(payload, f)

    def display( self, startIndex = 0, block=True ):
        FIG_HT = 5
        FIG_WID = 6
        if len( self.plotNames ) == 0:
            return
        if len( self.plotNames ) <= 3:
            nrows = len( self.plotNames )
            ncols = 1
        elif len( self.plotNames ) == 4:
            nrows = 2
            ncols = 2
        elif len( self.plotNames ) <= 6:
            nrows = 3
            ncols = 2
        else:
            nrows = int( np.sqrt( len( self.plotNames ) -1 ) )+1
            ncols = 1 + (len( self.plotNames ) -1) // nrows
        
        if len( self.plotNames ) <= 9:   
            sx = ncols * FIG_WID
            sy = nrows * FIG_HT
        else:
            sx = 3 * FIG_HT
            sy = 3 * FIG_WID

        if self.plotFile != None and (self.plotFile.split('.')[-1] == "json"):
            self.plots2json( nrows, ncols, self.plotFile )
            return

        fig, axes = plt.subplots( nrows = nrows, ncols = ncols, 
            figsize = (sx, sy), squeeze = False )
        for idx, i in enumerate( self.plotNames ):
            ax = axes[idx % nrows, idx // nrows]
            ax.set_title( i[1], fontsize = 18 )
            ax.set_xlabel( "Time (s)", fontsize = 16 )
            ax.set_ylabel( i[4], fontsize = 16 )
            ax.tick_params(axis='both', which='major', labelsize=14)
            vtab = moose.vec( i[0] )
            if i[5] == 'spikeTime':
                k = 0
                tmax = moose.element( '/clock' ).currentTime
                for j in vtab: # Plot a raster
                    y = [k] * len( j.vector )
                    ax.plot( j.vector * i[3], y, linestyle = 'None', marker = '.', markersize = 10 )
                    ax.set_xlim( 0, tmax )
                
            else:
                t = np.arange( 0, vtab[0].vector.size, 1 ) * vtab[0].dt
                if len( t ) <=1:
                    print( "Warning: no points on plot {}. Check that your plot Dt < runtime.".format( i[1] ) )
                for j in vtab:
                    ax.plot( t, j.vector * i[3] )
            
        #if hasattr( self, 'moogli' ) or len( self.wavePlotNames ) > 0:
        if len( self.wavePlotNames ) > 0:
            plt.ion()
        # Here we build the plots and lines for the waveplots
        self.initWavePlots( startIndex )
        if len( self.wavePlotNames ) > 0:
            for i in range( 3 ):
                self.displayWavePlots()
        plt.tight_layout()
        if self.plotFile == None:
            plt.show( block=block )
        else:
            try:
                plt.savefig( self.plotFile )
            except Exception as e:
                print(f"Error while saving jardesigner plot : {e}")
        

    def initWavePlots( self, startIndex ):
        self.frameDt = moose.element( '/clock' ).currentTime/self.numWaveFrames
        for wpn in range( len(self.wavePlotNames) ):
            i = self.wavePlotNames[wpn]
            vtab = moose.vec( i[0] )
            if len( vtab ) < 2:
                print( "Warning: Waveplot {} abandoned, only {} points".format( i[1], len( vtab ) ) )
                continue
            dFrame = int( len( vtab[0].vector ) / self.numWaveFrames )
            if dFrame < 1:
                dFrame = 1
            vpts = np.array( [ [k.vector[j] for j in range( 0, len( k.vector ), dFrame ) ] for k in vtab] ).T * i[3]
            fig = plt.figure( i[2] + startIndex )
            ax = fig.add_subplot( 111 )
            plt.title( i[1] )
            plt.xlabel( "position (voxels)" )
            plt.ylabel( i[4] )
            plotinfo = i[5]
            if plotinfo.ymin == plotinfo.ymax:
                mn = np.min(vpts)
                mx = np.max(vpts)
                if mn/mx < 0.3:
                    mn = 0
            else:
                mn = plotinfo.ymin
                mx = plotinfo.ymax
            ax.set_ylim( mn, mx )
            line, = plt.plot( range( len( vtab ) ), vpts[0] )
            timeLabel = plt.text( len(vtab ) * 0.05, mn + 0.9*(mx-mn), 'time = 0' )
            self.wavePlotNames[wpn].append( [fig, line, vpts, timeLabel] )
            fig.canvas.draw()

    def displayWavePlots( self ):
        for f in range( self.numWaveFrames ):
            for i in self.wavePlotNames:
                wp = i[6]
                if len( wp[2] ) > f:
                    wp[1].set_ydata( wp[2][f] )
                    wp[3].set_text( "time = {:.1f}".format(f*self.frameDt) )
                    #wp[0].canvas.draw()
                    wp[0].canvas.flush_events()
            #plt.pause(0.001)
        

    ################################################################
    # Here we get the time-series data and write to various formats
    ################################################################
    '''
    The original author of the functions -- [_savePlots(), _writeXML(), _writeCSV(), _save()] is Sarthak Sharma.
    Email address: sarthaks442@gmail.com
    Heavily modified by U.S. Bhalla
    '''
    def _writeXML( self, plotData, time, vtab ): 
        tabname = plotData[0]
        idx = plotData[1]
        scale = plotData[2]
        units = plotData[3]
        rp = plotData[4]
        filename = rp.saveFile[:-4] + str(idx) + '.xml'
        root = etree.Element("TimeSeriesPlot")
        parameters = etree.SubElement( root, "parameters" )
        if self.params == None:
            parameters.text = "None"
        else:
            assert(isinstance(self.params, dict)), "'params' should be a dictionary."
            for pkey, pvalue in self.params.items():
                parameter = etree.SubElement( parameters, str(pkey) )
                parameter.text = str(pvalue)

        #plotData contains all the details of a single plot
        title = etree.SubElement( root, "timeSeries" )
        title.set( 'title', rp.title)
        title.set( 'field', rp.field)
        title.set( 'scale', str(scale) )
        title.set( 'units', units)
        title.set( 'dt', str(vtab[0].dt) )
        res = rp.saveResolution
        p = []
        for t, v in zip( time, vtab ):
            p.append( etree.SubElement( title, "data"))
            p[-1].set( 'path', v.path )
            p[-1].text = ''.join( str(round(y,res)) + ' ' for y in v.vector )
        tree = etree.ElementTree(root)
        tree.write(filename)

    def _writeCSV( self, plotData, time, vtab ): 
        tabname = plotData[0]
        idx = plotData[1]
        scale = plotData[2]
        units = plotData[3]
        rp = plotData[4]
        filename = rp.saveFile[:-4] + str(idx) + '.csv'

        header = ["time",]
        valMatrix = [time,]
        header.extend( [ v.path for v in vtab ] )
        valMatrix.extend( [ v.vector for v in vtab ] )
        nv = np.array( valMatrix ).T
        with open(filename, 'wb') as f:
            writer = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
            writer.writerow(header)
            for row in nv:
                writer.writerow(row)

    ##########****SAVING*****###############

    def _save( self ):
        self._finishedSaving = True
        if not hasattr( self, 'files' ) or not hasattr(self, 'nsdfPathList' ):
            return
        # Stuff here for doing saves to different formats
        for nsdfPath in self.nsdfPathList:
            nsdf = moose.element( nsdfPath )
            nsdf.close()
        '''
        for i in self.saveNames:
            tabname = i[0]
            idx = i[1]
            scale = i[2]
            units = i[3]
            rp = i[4] # The rplot data structure, it has the setup info.

            vtab = moose.vec( tabname )
            t = np.arange( 0, vtab[0].vector.size, 1 ) * vtab[0].dt
            ftype = rp.filename[-4:]
            if ftype == '.xml':
                self._writeXML( i, t, vtab )
            elif ftype == '.csv':
                self._writeCSV( i, t, vtab )
            else:
                print("Save format '{}' not known, please use .csv or .xml".format( ftype ) )
        '''

    ################################################################
    # Here we set up the stims
    ################################################################
    def _buildOneStim( self, model ):
        knownFields = {
                'inject':('CompartmentBase', 'setInject'),
                'Ca':('CaConcBase', 'setCa'),
                'n':('PoolBase', 'setN'),
                'conc':('PoolBase', 'setConc'),
                'nInit':('PoolBase', 'setNinit'),
                'concInit':('PoolBase', 'setConcInit'),
                'increment':('PoolBase', 'increment'),
                'vclamp':('CompartmentBase', 'setInject'),
                'randsyn':('SynChan', 'addSpike'),
                'periodicsyn':('SynChan', 'addSpike')
        }
        stims = moose.Neutral( model.path + '/stims' )
        elecid = moose.element( model.path + '/elec' )
        #expr = model.path[7] + "e-8*(t>0.1)*(t<0.2)" if len(model.path)>7 else "0"
        k = 0
        for i in self.stims:
            stimType = i['type']
            if stimType == 'field':
                field = i['field']
            else:   # Backward compat. In the json file it is cleaner.
                field = stimType
            pair = i['path'] + " " + i['geomExpr']
            dendCompts = elecid.compartmentsFromExpression[ pair ]
            #print( "BUILD COMPTS FROM EXPR = ", dendCompts )
            if field == 'vclamp':
                stimObj = self._buildVclampOnCompt( dendCompts, [] )
                stimField = 'commandIn'
            elif field == 'randsyn':
                stimObj = self._buildSynInputOnCompt( dendCompts, [], i )
                stimField = 'setRate'
            elif field == 'periodicsyn':
                stimObj = self._buildSynInputOnCompt( dendCompts, [], i, doPeriodic = True )
                stimField = 'setRate'
            else:
                stimObj, stimField = self._parseComptField( dendCompts, i, knownFields )
                #print( "STIM OBJ: ", [k.dataIndex for k in stimObj] )
                #print( "STIM OBJ: ", [k.coords[0] for k in stimObj] )
            i['stimObjList'] = stimObj
            numStim = len( stimObj )
            if numStim > 0:
                funcname = stims.path + '/stim' + str(k)
                k += 1
                func = moose.Function( funcname )
                func.expr = i['expr']
                #func.expr = expr
                func.doEvalAtReinit = 1
                for q in stimObj:
                    moose.connect( func, 'valueOut', q, stimField )
                    #print( "connecting stim: ", func.path, q.path + "[", q.dataIndex, "]." + stimField )
                if stimField == "increment": # Has to be under Ksolve
                    moose.move( func, q )
        #print( "Built Stim on ", model.path )

    def _buildStims( self ):
        if not hasattr( self, 'stims' ):
            return
        for model in self.modelList:
            self._buildOneStim( model )

    ################################################################
    def _configureHSolve( self ):
        if not self.turnOffElec:
            for model in self.modelList:
                elecidpath = model.path + '/elec'
                hsolve = moose.HSolve( elecidpath + '/hsolve' )
                hsolve.dt = self.elecDt
                hsolve.target = elecidpath + '/soma'

# Utility function for setting up clocks.
    def _configureClocks( self ):
        if self.turnOffElec:
            elecDt = 1e6
            elecPlotDt = 1e6
        else:
            elecDt = self.elecDt
            elecPlotDt = self.elecPlotDt
        diffDt = self.diffDt
        chemDt = self.chemDt
        for i in range( 0, 9 ):     # Assign elec family of clocks
            moose.setClock( i, elecDt )
        moose.setClock( 8, elecPlotDt ) 
        moose.setClock( 10, diffDt )# Assign diffusion clock.
        for i in range( 11, 18 ):   # Assign the chem family of clocks.
            moose.setClock( i, chemDt )
        if not self.turnOffElec:    # Assign the Function clock
            moose.setClock( 12, self.funcDt )
        moose.setClock( 18, self.chemPlotDt )
        sys.stdout.flush()
    ################################################################

    def validateFromMemory( self, epath, cpath ):
        return self.validateChem()

    #################################################################
    # assumes ePath is the parent element of the electrical model,
    # and cPath the parent element of the compts in the chem model
    def buildFromMemory( self, ePath, cPath, doCopy = False ):
        if not self.validateFromMemory( ePath, cPath ):
            return
        if doCopy:
            x = moose.copy( cPath, self.model )
            self.chemid = moose.element( x )
            self.chemid.name = 'chem'
            x = moose.copy( ePath, self.model )
            self.elecid = moose.element( x )
            self.elecid.name = 'elec'
        else:
            self.elecid = moose.element( ePath )
            self.chemid = moose.element( cPath )
            if self.elecid.path != self.model.path + '/elec':
                if ( self.elecid.parent != self.model ):
                    moose.move( self.elecid, self.model )
                self.elecid.name = 'elec'
            if self.chemid.path != self.model.path + '/chem':
                if ( self.chemid.parent != self.model ):
                    moose.move( self.chemid, self.model )
                self.chemid.name = 'chem'


        ep = self.elecid.path
        somaList = moose.wildcardFind( ep + '/#oma#[ISA=CompartmentBase]' )
        if len( somaList ) == 0:
            somaList = moose.wildcardFind( ep + '/#[ISA=CompartmentBase]' )
        assert( len( somaList ) > 0 )
        maxdia = 0.0
        for i in somaList:
            if ( i.diameter > maxdia ):
                self.soma = i
        #self.soma = self.comptList[0]
        self._decorateWithSpines()
        self.spineList = moose.wildcardFind( ep + '/#spine#[ISA=CompartmentBase],' + ep + '/#head#[ISA=CompartmentBase]' )
        if len( self.spineList ) == 0:
            self.spineList = moose.wildcardFind( ep + '/#head#[ISA=CompartmentBase]' )
        nmdarList = moose.wildcardFind( ep + '/##[ISA=NMDAChan]' )

        self.comptList = moose.wildcardFind( ep + '/#[ISA=CompartmentBase]')
        print("jardesigner: Elec model has ", len( self.comptList ),
            " compartments and ", len( self.spineList ),
            " spines with ", len( nmdarList ), " NMDARs")


        # This is outdated. I haven't run across a case yet where we
        # call it this way. Haven't updated.
        #self._buildNeuroMesh()

        self._configureChemSolvers()
        for i in self.adaptors:
            #  print(i)
            assert len(i) >= 8
            self._buildAdaptor( i[0],i[1],i[2],i[3],i[4],i[5],i[6],i[7] )

    ################################################################
    ## The spineid is the parent object of the prototype spine. The
    ## spine prototype can include any number of compartments, and each
    ## can have any number of voltage and ligand-gated channels, as well
    ## as CaConc and other mechanisms.
    ## The parentList is a list of Object Ids for parent compartments for
    ## the new spines
    ## The spacingDistrib is the width of a normal distribution around
    ## the spacing. Both are in metre units.
    ## The reference angle of 0 radians is facing away from the soma.
    ## In all cases we assume that the spine will be rotated so that its
    ## axis is perpendicular to the axis of the dendrite.
    ## The simplest way to put the spine in any random position is to have
    ## an angleDistrib of 2 pi. The algorithm selects any angle in the
    ## linear range of the angle distrib to add to the specified angle.
    ## With each position along the dendrite the algorithm computes a new
    ## spine direction, using rotation to increment the angle.
    ################################################################
    def _decorateWithSpines( self ):
        args = []
        for i in self.addSpineList:
            if not moose.exists( '/library/' + i[0] ):
                print('Warning: _decorateWithSpines: spine proto ', i[0], ' not found.')
                continue
            s = ""
            for j in range( 9 ):
                s = s + str(i[j]) + ' '
            args.append( s )
        self.elecid.spineSpecification = args
        self.elecid.parseSpines()

    ################################################################

    def _loadElec( self, efile, elecname ):
        self._modelFileNameList.append( efile )
        if ( efile[ len( efile ) - 2:] == ".p" ):
            self.elecid = moose.loadModel( efile, '/library/' + elecname)
        elif ( efile[ len( efile ) - 4:] == ".swc" ):
            self.elecid = moose.loadModel( efile, '/library/' + elecname)
        else:
            nm = NeuroML()
            nm.readNeuroMLFromFile( efile, \
                    params = {'combineSegments': self.combineSegments, \
                    'createPotentialSynapses': True } )
            if moose.exists( '/cells' ):
                kids = moose.wildcardFind( '/cells/#' )
            else:
                kids = moose.wildcardFind( '/library/#[ISA=Neuron],/library/#[TYPE=Neutral]' )
                if ( kids[0].name == 'spine' ):
                    kids = kids[1:]

            assert( len( kids ) > 0 )
            self.elecid = kids[0]
            temp = moose.wildcardFind( self.elecid.path + '/#[ISA=CompartmentBase]' )

        jp.transformNMDAR( self.elecid.path )
        kids = moose.wildcardFind( '/library/##[0]' )
        for i in kids:
            i.tick = -1


    #################################################################

    def _isModelFromKkit_SBML( self ):
        for i in self.chemProtoList:
            if i[0][-2:] == ".g" or i[0][-4:] == ".xml":
                return True
        return False

    def _assignComptNamesFromKkit_SBML( self, modelpath ):
        comptList = moose.wildcardFind( modelpath + '/temp_chem/##[ISA=ChemCompt]' )
        if len( comptList ) == 0:
            print( "EMPTY comptlist: ", modelpath, "/temp_chem, found kinetics" )
        return comptList


    #################################################################

    def _buildChemLine( self, line, smjl, pmjl, emjl, comptDict, isAllDends ):
        chemSrc = line['proto']
        elecPath = line['path']
        meshType = line['type']
        meshPath = self.meshDict[ chemSrc ]
        #print( "BUILD CHEM LINE: ", chemSrc, elecPath, meshType, meshPath )
        # Normally dend remains determ, if no other compt it can be stoch
        #if self.useGssa and meshType != 'dend':
        if self.useGssa and (meshType != 'dend' or isAllDends ):
            ksolve = moose.Gsolve( meshPath + '/ksolve' )
        else:
            ksolve = moose.Ksolve( meshPath + '/ksolve' )
            ksolve.method = self.odeMethod
        dsolve = moose.Dsolve( meshPath + '/dsolve' )
        stoich = moose.Stoich( meshPath + '/stoich' )
        stoich.compartment = moose.element(meshPath)
        stoich.ksolve = ksolve
        stoich.dsolve = dsolve
        if meshType == 'psd':
            if len( moose.wildcardFind( meshPath + '/##[ISA=PoolBase]' ) ) == 0:
                moose.Pool( meshPath + '/dummy' )
        stoich.reacSystemPath = meshPath + "/##"
        # The middle arg in these cases used to be the geom. Not relevant.
        # The middle arg line[4] Now looks like it is the parent compt.
        if meshType == 'spine':
            smjl.append( [meshPath, line['parent'], dsolve])
        if meshType == 'psd':
            pmjl.append( [meshPath, line['parent'], dsolve] )
        elif meshType == 'endo':
            # Endo mesh is easy as it explicitly defines surround.
            emjl.append( [meshPath, line['parent'], dsolve] )

    # ComptDict was set up with respect to the original single model.
    def _buildChemJunctions( self, smjl, pmjl, emjl, meshDict ):
        #print( f"SMJL={len(smjl)}, PMJL={len(pmjl)}, EMJL={len(emjl)}, MeshDict={len( meshDict )} )" )
        for sm, pm in zip( smjl, pmjl ):
            # Locate associated NeuroMesh and PSD mesh
            if sm[1] == pm[1]:  # Check for same parent dend.
                nmeshPath = meshDict[ sm[1] ]
                if self.verbose:
                    print( "NeuroMeshPath = ", nmeshPath )
                dmdsolve = moose.element( nmeshPath + "/dsolve" )
                dmdsolve.buildNeuroMeshJunctions( sm[2], pm[2] )
                # set up the connections so that the spine volume scaling can happen
                self.elecid.setSpineAndPsdMesh( moose.element(sm[0]), moose.element(pm[0]))
                self.elecid.setSpineAndPsdDsolve( sm[2], pm[2] )

        for em in emjl:
            emdsolve = em[2]
            surroundMeshPath = meshDict[ em[1]]
            if self.verbose:
                print( "surroundMESHPATH = ", surroundMeshPath )
            surroundDsolve = moose.element( surroundMeshPath + "/dsolve" )
            #print( f"IN emjl, surround={surroundMeshPath}, surroundDsolve = {surroundDsolve.path}" )
            emdsolve.buildMeshJunctions( surroundDsolve )

    def _configureChemSolvers( self ):
        if not hasattr( self, 'chemDistrib' ) or len( self.chemDistrib ) == 0:
            return
        for model in self.modelList:
            tempComptDict = { key:val.replace( "model", model.name ) for key, val in self.meshDict.items() }
            chempath = model.path + "/chem"
            #fixXreacs.fixXreacs( chempath )
            sortedChemDistrib = sorted( self.chemDistrib, key = lambda c: meshOrder.index( c['type'] ) )
            spineMeshJunctionList = []
            psdMeshJunctionList = []
            endoMeshJunctionList = []
            numDends = len( [cc for cc in sortedChemDistrib if cc['type'] == 'dend'] )
            isAllDends = ( numDends == len( sortedChemDistrib ) )
            for line in sortedChemDistrib:
                self._buildChemLine( line, spineMeshJunctionList,
                    psdMeshJunctionList, endoMeshJunctionList, 
                    tempComptDict, isAllDends )
            self._buildChemJunctions( spineMeshJunctionList,
                    psdMeshJunctionList, endoMeshJunctionList, 
                    tempComptDict )

    ################################################################

    def _loadChem( self, fname, chemName ):
        self._modelFileNameList.append( fname )
        chem = moose.Neutral( '/library/' + chemName )
        pre, ext = os.path.splitext( fname )
        if ext == '.xml' or ext == '.sbml':
            modelId = moose.readSBML( fname, chem.path )
        else:
            modelId = moose.loadModel( fname, chem.path, 'ee' )
        #comptlist = moose.wildcardFind( chem.path + '/##[ISA=ChemCompt]' )
        comptlist = moose.wildcardFind( '/library/##[ISA=ChemCompt]' )
        if len( comptlist ) == 0:
            print("Error: loadChem: No compartment found in file: ", fname)
            return
        fixXreacs.fixXreacs( chem.path )
        self.comptDict.update( {cc.name:cc.path for cc in comptlist } )
        #print( f"Loaded chem file {fname} to {chemName}, comptDic={self.comptDict}" )

    ################################################################

    def _moveCompt( self, a, b ):

        #print( "moveCompt: ", a, b )
        b.setVolumeNotRates( a.volume )
        # Potential problem: If we have grouped sub-meshes down one level in the tree, this will silenty move those too.
        for i in moose.wildcardFind( a.path + '/#' ):
            #if ( i.name != 'mesh' ):
            if not ( i.isA('ChemCompt' ) or i.isA( 'MeshEntry' ) ):
                moose.move( i, b )
                #print( "Moving {} {} to {}".format( i.className, i.name, b.name ))
        moose.delete( a.path )

    ################################################################
    def _buildAdaptor( self, meshName, elecRelPath, elecField, \
            chemRelPath, chemField, isElecToChem, offset, scale ):
        #print "offset = ", offset, ", scale = ", scale
        # print( "1111 buildAdaptor: {} {}.{} {}.{} ".format( meshName, elecRelPath, elecField, chemRelPath, chemField ) )
        if moose.exists( '/model/chem/' + meshName ):
            mesh = moose.element( '/model/chem/' + meshName )
        elif moose.exists( '/model/chem/kinetics/' + meshName ):
            mesh = moose.element( '/model/chem/kinetics/' + meshName )
        else:
            print( "rdes::buildAdaptor: Error: meshName not found: ", meshName )
            quit()
        #elecComptList = mesh.elecComptList
        if elecRelPath == 'spine':
            # This is nasty. The spine indexing is different from
            # the compartment indexing and the mesh indexing and the 
            # chem indexing. Need to fix at some time.
            #elecComptList = moose.vec( mesh.elecComptList[0].path + '/../spine' )
            elec = moose.element( '/model/elec' )
            elecComptList = [ elec.spineFromCompartment[i.me] for i in mesh.elecComptList ]
            #elecComptList = moose.element( '/model/elec').spineIdsFromCompartmentIds[ mesh.elecComptList ]
            #elecComptList = mesh.elecComptMap
        else:
            #print("Building adapter: elecComptList '", mesh.elecComptList, "' on mesh: '", mesh.path , "' with elecRelPath = ", elecRelPath )
            elecComptList = mesh.elecComptList

        if len( elecComptList ) == 0:
            raise BuildError( \
                "buildAdaptor: no elec compts in elecComptList on: " + \
                mesh.path )
        startVoxelInCompt = mesh.startVoxelInCompt
        endVoxelInCompt = mesh.endVoxelInCompt
        capField = elecField[0].capitalize() + elecField[1:]
        capChemField = chemField[0].capitalize() + chemField[1:]
        chemPath = mesh.path + '/' + chemRelPath
        # print( "ADAPTOR: elecCompts = {}; startVx = {}, endVox = {}, chemPath = {}".format( [i.name for i in elecComptList], startVoxelInCompt, endVoxelInCompt, chemPath ) )
        if not( moose.exists( chemPath ) ):
            raise BuildError( \
                "Error: buildAdaptor: no chem obj in " + chemPath )
        chemObj = moose.element( chemPath )
        #print( "CHEMPATH = ", chemPath, chemObj )
        assert( chemObj.numData >= len( elecComptList ) )
        adName = f"adapt_{elecComptList[0].name}_to_{chemObj.name}"
        '''
        for i in range( 1, len( elecRelPath ) ):
            if ( elecRelPath[-i] == '/' ):
                adName += elecRelPath[1-i]
                break
        '''
        ad = moose.Adaptor( chemObj.path + '/' + adName, len( elecComptList ) )
        elmList = [ moose.element( ee ) for ee in elecComptList ]
        self.adaptorElecComptList[adName] = (elecRelPath, chemRelPath, elmList )
        # print( 'building ', len( elecComptList ), 'adaptors ', adName, ' for: ', mesh.name, elecRelPath, elecField, chemRelPath )
        av = ad.vec
        chemVec = moose.element( mesh.path + '/' + chemRelPath ).vec

        for i in zip( elecComptList, startVoxelInCompt, endVoxelInCompt, av ):
            i[3].inputOffset = 0.0
            i[3].outputOffset = offset
            i[3].scale = scale
            if elecRelPath == 'spine':
                # Check needed in case there were unmapped entries in 
                # spineIdsFromCompartmentIds
                elObj = i[0]
                #print( "EL OBJ = ", elObj.path )
                #moose.showfield( elObj.me )
                if elObj.path == "/":
                    continue
            else:
                ePath = i[0].path + '/' + elecRelPath
                #print( "EPATH = ", ePath )
                if not( moose.exists( ePath ) ):
                    print( "Error: NOT SPINE", ePath, "DOESN'T EXIST, bailing" )
                    continue
                    #raise BuildError( "Error: buildAdaptor: no elec obj in " + ePath )
                elObj = moose.element( i[0].path + '/' + elecRelPath )
            if isElecToChem:
                elecFieldSrc = 'get' + capField
                chemFieldDest = 'set' + capChemField
                #print ePath, elecFieldSrc, scale
                moose.connect( i[3], 'requestOut', elObj, elecFieldSrc )
                for j in range( i[1], i[2] ):
                    moose.connect( i[3], 'output', chemVec[j],chemFieldDest)
                    #print( "connect elecToChem:", i[3].path, 'input: ', elObj, elecFieldSrc, 'output', chemVec[j].name, chemFieldDest)
            else:
                chemFieldSrc = 'get' + capChemField
                if capField == 'Activation':
                    elecFieldDest = 'activation'
                else:
                    elecFieldDest = 'set' + capField
                for j in range( i[1], i[2] ):
                    moose.connect( i[3], 'requestOut', chemVec[j], chemFieldSrc)
                    #print( "connect chemToElec:", i[3].name, 'requestOut', chemVec[j].name, chemFieldSrc)
                msg = moose.connect( i[3], 'output', elObj, elecFieldDest )
                #print( "Connect chemToElec: Connecting {} to {} and {}.{}".format( i[3], chemVec[0], elObj, elecFieldDest ) )
        #moose.showfield( ad )



def squareGridPlacementFunc( numModels, idx ):
    nx = int( np.sqrt( numModels ) )
    return 0.5e-3 * (idx // nx), 0.5e-3 * (idx % nx), 0.0

def randomPlacementFunc( numModels, idx ):
    nx = int( np.sqrt( numModels ) )
    return np.random.random()*0.5e-3, np.random.random()*0.5e-3, 0.0

# ============================================================================
# Pause/Resume Threading Support
# ============================================================================
_simulation_thread = None
_is_paused = False
_remaining_runtime = 0
_target_simtime = 0

def _run_simulation(rdes, runtime):
    """Run MOOSE simulation in background thread."""
    global _remaining_runtime, _target_simtime, _is_paused
    
    start_simtime = moose.element("/clock").currentTime
    _target_simtime = start_simtime + runtime
    
    moose.start(runtime)
    
    current_simtime = moose.element("/clock").currentTime
    _remaining_runtime = max(0, _target_simtime - current_simtime)
    
    if _remaining_runtime <= 1e-9 and not _is_paused:
        rdes.display()
        time.sleep(0.1)
        rdes.runMooView.notifySimulationEnd(rdes.dataChannelId)

def serverCommandLoop( rdes ):
    global _simulation_thread, _is_paused, _remaining_runtime
    
    # This loop will wait for commands from server.py via stdin
    for line in sys.stdin:
        try:
            # Parse the command, which is expected to be a JSON string
            command_data = json.loads(line)
            command = command_data.get("command")

            if command == "start":
                runtime = command_data.get("params", {}).get("runtime", rdes.runtime)
                if moose.element("/clock").currentTime == 0:
                    if hasattr(rdes, 'moogli') and len(rdes.moogli) > 0:
                        rdes.runMooView.sendSceneGraph("run")

                _is_paused = False
                _remaining_runtime = runtime

                _simulation_thread = threading.Thread(
                    target=_run_simulation,
                    args=(rdes, runtime),
                    daemon=True
                )
                _simulation_thread.start()

            elif command == "pause":
                if _simulation_thread and _simulation_thread.is_alive():
                    _is_paused = True
                    moose.stop()
                    _simulation_thread.join(timeout=2.0)
                    print(f"Paused at t={moose.element('/clock').currentTime:.4f}s", flush=True)

            elif command == "resume":
                if _is_paused and _remaining_runtime > 1e-9:
                    _is_paused = False
                    _simulation_thread = threading.Thread(
                        target=_run_simulation,
                        args=(rdes, _remaining_runtime),
                        daemon=True
                    )
                    _simulation_thread.start()
                    print("Simulation resumed", flush=True)

            elif command == "reset":
                if _simulation_thread and _simulation_thread.is_alive():
                    moose.stop()
                    _simulation_thread.join(timeout=2.0)
                _is_paused = False
                _remaining_runtime = 0
                moose.reinit()

            elif command == "quit":
                if _simulation_thread and _simulation_thread.is_alive():
                    moose.stop()
                    _simulation_thread.join(timeout=2.0)
                print("Received 'quit' command. Exiting.")
                break

            else:
                print(f"Warning: Unknown command '{command}'")

        except json.JSONDecodeError:
            print(f"Warning: Received non-JSON command: {line.strip()}")

        sys.stdout.flush()


def main():
    try:
        parser = argparse.ArgumentParser(description="Load and optionally run MOOSE model specified using jardesigner.")
        parser.add_argument( "file", type=str, help = "Required: Filename of model file, in json format." )
        parser.add_argument( '-r', '--run', action="store_true", help='Run model immediately upon loading, as per directives in rdes file.' )
        parser.add_argument( '-p', '--plotFile', type=str, help='Optional: Save plots to an svg file with the specified name, instead of displaying them.' )
        parser.add_argument( '--placementFunc', type=str, help='Optional: Pick a builtin placement function for multiple models. Options: squareGrid, random. Default: None' )
        parser.add_argument( '-n', '--numModels', type=int, help='Optional: Number of models to make. Default = 1', default = 1 )
        parser.add_argument( '-v', '--verbose', action="store_true", help='Verbose flag. Prints out diagnostics when set.' )
        parser.add_argument('--data-channel-id', help='Unique ID for this simulation run, used in server mode for jardesigner interface. If not set we are in standalone mode.')
        parser.add_argument('--session-path', type=str, help='Temp directory for model and plot files, used in server mode for jardesigner interface.')
        args = parser.parse_args()
        rdes = JarDesigner( args.file, plotFile = args.plotFile, 
            jsonData = None, dataChannelId = args.data_channel_id, 
            sessionDir = args.session_path,
            verbose = args.verbose )
        context.setContext( rdes )
        pf = None
        if args.placementFunc == "squareGrid":
            pf = squareGridPlacementFunc
        elif args.placementFunc == "random":
            pf = randomPlacementFunc
        rdes.buildModel( numModels = args.numModels, placementFunc = pf )
        #print( "jardesigner.py: built model" )
        if rdes.dataChannelId:
            rdes._buildSetupMoogli()
            reacGraph = jrg.get_reaction_graph( "/library" )
            #rdes._buildReactionGraph()
            rdes.setupMooView.sendSceneGraph( "setup", meshMols=rdes.meshMols, reacGraph = reacGraph )
            #print( "jardesigner.py: sent SceneGraph1 with meshMols:", rdes.meshMols )
    
        moose.reinit()
        if args.run and args.data_channel_id == None: # local run
            #print( "Running locally")
            moose.start( rdes.runtime )
            rdes.display()
            if rdes.runMooView and len( rdes.moogli ) > 0:
                rdes.runMooView.sendSceneGraph( "run" )
                rdes.runMooView.notifySimulationEnd( None )
            quit()
    
        serverCommandLoop( rdes )
    except Exception as e:
        # Create a structured error message
        error_msg = {
            # CHANGED: Use standard 'error' type in case frontend ignores 'sim_error'
            "type": "error", 
            "message": str(e),
            "details": traceback.format_exc()
        }
        # Print JSON so server can parse it
        print(json.dumps(error_msg))
        sys.stdout.flush()
        
        # ADDED: Force non-zero exit code so server knows the process failed
        sys.exit(1)

if __name__ == "__main__":
    main()